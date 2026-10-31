import assert from "node:assert/strict";
import test from "node:test";
import { dispatchApprovedPosts, dispatchApprovedPostsWithSupabase, hasDispatchFailures, recordDispatchBatch } from "../src/lib/approved-dispatch";
import type { PostPublishingOutcome } from "../src/lib/post-publishing";

test("recovers previously approved posts after interruption without resending confirmed or uncertain posts", async () => {
  const states = new Map([
    ["manual-1", "scheduled"],
    ["manual-2", "approved"],
    ["luma-1", "approved"],
    ["uncertain", "needs_reconciliation"],
    ["in-flight", "scheduling"],
  ]);
  const sent: string[] = [];
  const run = () => dispatchApprovedPosts(
    async () => [...states].filter(([, status]) => status === "approved").map(([id]) => id),
    async (id): Promise<PostPublishingOutcome> => {
      if (states.get(id) !== "approved") return { kind: "not_claimed" };
      states.set(id, "scheduled");
      sent.push(id);
      return { kind: "scheduled", bufferPostId: `buffer-${id}` };
    },
  );
  const first = await run();
  const second = await run();
  assert.deepEqual(sent, ["manual-2", "luma-1"]);
  assert.equal(first.scheduled, 2);
  assert.equal(second.scheduled, 0);
  assert.equal(states.get("uncertain"), "needs_reconciliation");
  assert.equal(states.get("in-flight"), "scheduling");
});


test("one bad delivery does not strand other approved posts and concurrent claims are not retried", async () => {
  const calls: string[] = [];
  const result = await dispatchApprovedPosts(async () => ["error", "uncertain", "claimed", "ok", "failed"], async (id) => {
    calls.push(id);
    if (id === "error") throw new Error("database unavailable");
    if (id === "uncertain") return { kind: "needs_reconciliation", message: "unknown" };
    if (id === "claimed") return { kind: "not_claimed" };
    if (id === "failed") return { kind: "failed", message: "rejected" };
    return { kind: "scheduled", bufferPostId: "remote-id" };
  });
  assert.deepEqual(calls, ["error", "uncertain", "claimed", "ok", "failed"]);
  assert.deepEqual(result, { selected: 5, scheduled: 1, failed: 1, needsReconciliation: 1, notClaimed: 1, errors: 1, deferred: 0 });
});

test("database lookup failure is returned without attempting a delivery", async () => {
  const db = { rpc: async () => ({ data: null, error: { message: "db unavailable" } }) };
  let calls = 0;
  await assert.rejects(() => dispatchApprovedPostsWithSupabase(db, "owner", null, async () => {
    calls += 1;
    return new Response();
  }), /publicaciones aprobadas pendientes/);
  assert.equal(calls, 0);
});

test("database recovery uses persisted owner and event scope and schedules through Buffer", async () => {
  const priorKey = process.env.BUFFER_API_KEY_PERSONAL;
  process.env.BUFFER_API_KEY_PERSONAL = "test-key";
  const states = new Map([["first", "scheduled"], ["manual", "approved"], ["luma", "approved"], ["uncertain", "needs_reconciliation"]]);
  const listArguments: Record<string, unknown>[] = [];
  const rpcCalls: string[] = [];
  const sent: string[] = [];
  const db = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push(name);
      const execute = async () => {
        if (name === "list_approved_posts_for_dispatch") {
          listArguments.push(args);
          return { data: [...states].filter(([, state]) => state === "approved").map(([id]) => ({ id })), error: null };
        }
        const id = String(args.p_post_id);
        if (name === "claim_post_for_scheduling") {
          if (states.get(id) !== "approved") return { data: null, error: null };
          states.set(id, "scheduling");
          return { data: { id, attempt_id: `attempt-${id}`, account_id: "personal", network: "LinkedIn", due_at: "2099-11-07T12:00:00.000Z", content: id }, error: null };
        }
        if (name === "mark_post_scheduled") states.set(id, "scheduled");
        return { data: null, error: null };
      };
      return { maybeSingle: execute, then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => execute().then(resolve, reject) };
    },
    from(table: string) {
      if (table === "accounts") return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Personal" }, error: null }) }) }) }) };
      return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { buffer_channel_id: "channel" }, error: null }) }) }) }) }) };
    },
  };
  const fetchImpl: typeof fetch = async (_url, request) => {
    const body = JSON.parse(String(request?.body));
    const text = body.variables.input.text as string;
    sent.push(text);
    return new Response(JSON.stringify({ data: { createPost: { __typename: "PostActionSuccess", post: { id: `buffer-${text}`, text } } } }));
  };
  try {
    const first = await dispatchApprovedPostsWithSupabase(db, "owner-id", "event-id", fetchImpl);
    const second = await dispatchApprovedPostsWithSupabase(db, "owner-id", "event-id", fetchImpl);
    assert.deepEqual(listArguments[0], { p_owner_id: "owner-id", p_event_id: "event-id", p_limit: 50 });
    assert.deepEqual(sent, ["manual", "luma"]);
    assert.equal(first.scheduled, 2);
    assert.equal(second.selected, 0);
    assert.equal(states.get("uncertain"), "needs_reconciliation");
    assert.equal(rpcCalls.includes("approve_post"), false);
  } finally {
    if (priorKey === undefined) delete process.env.BUFFER_API_KEY_PERSONAL;
    else process.env.BUFFER_API_KEY_PERSONAL = priorKey;
  }
});


test("overlapping recovery runs make only one Buffer request for an approved post", async () => {
  const priorKey = process.env.BUFFER_API_KEY_PERSONAL;
  process.env.BUFFER_API_KEY_PERSONAL = "test-key";
  let state = "approved";
  let listCalls = 0;
  let releaseLists: (() => void) | undefined;
  const bothListed = new Promise<void>((resolve) => { releaseLists = resolve; });
  let requests = 0;
  const db = {
    rpc(name: string) {
      const execute = async () => {
        if (name === "list_approved_posts_for_dispatch") {
          listCalls += 1;
          if (listCalls === 2) releaseLists?.();
          await bothListed;
          return { data: [{ id: "shared" }], error: null };
        }
        if (name === "claim_post_for_scheduling") {
          if (state !== "approved") return { data: null, error: null };
          state = "scheduling";
          return { data: { id: "shared", attempt_id: "attempt-shared", account_id: "personal", network: "LinkedIn", due_at: "2099-11-07T12:00:00.000Z", content: "hello" }, error: null };
        }
        if (name === "mark_post_scheduled") state = "scheduled";
        return { data: null, error: null };
      };
      return { maybeSingle: execute, then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => execute().then(resolve, reject) };
    },
    from(table: string) {
      if (table === "accounts") return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Personal" }, error: null }) }) }) }) };
      return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { buffer_channel_id: "channel" }, error: null }) }) }) }) }) };
    },
  };
  const fetchImpl: typeof fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({ data: { createPost: { __typename: "PostActionSuccess", post: { id: "buffer-id", text: "hello" } } } }));
  };
  try {
    const results = await Promise.all([
      dispatchApprovedPostsWithSupabase(db, "owner", null, fetchImpl),
      dispatchApprovedPostsWithSupabase(db, "owner", null, fetchImpl),
    ]);
    assert.equal(requests, 1);
    assert.equal(state, "scheduled");
    assert.equal(results.reduce((sum, item) => sum + item.scheduled, 0), 1);
    assert.equal(results.reduce((sum, item) => sum + item.notClaimed, 0), 1);
  } finally {
    if (priorKey === undefined) delete process.env.BUFFER_API_KEY_PERSONAL;
    else process.env.BUFFER_API_KEY_PERSONAL = priorKey;
  }
});


test("a slow delivery defers remaining approved posts to the next run", async () => {
  let clock = 0;
  const states = new Map([["first", "approved"], ["second", "approved"]]);
  const list = async () => [...states].filter(([, state]) => state === "approved").map(([id]) => id);
  const schedule = async (id: string): Promise<PostPublishingOutcome> => {
    states.set(id, "scheduled");
    clock += 11_000;
    return { kind: "scheduled", bufferPostId: `buffer-${id}` };
  };
  const first = await dispatchApprovedPosts(list, schedule, { now: () => clock });
  assert.equal(first.scheduled, 1);
  assert.equal(first.deferred, 1);
  assert.equal(states.get("second"), "approved");
  const second = await dispatchApprovedPosts(list, schedule, { now: () => clock });
  assert.equal(second.scheduled, 1);
  assert.equal(second.deferred, 0);
});


test("shared budget counts delivery time but ignores time spent generating a later event", async () => {
  let clock = 0;
  const budget = { remainingMs: 10_000 };
  let sent = 0;
  const schedule = async (): Promise<PostPublishingOutcome> => {
    sent += 1;
    clock += 6_000;
    return { kind: "scheduled", bufferPostId: `remote-${sent}` };
  };
  const first = await dispatchApprovedPosts(async () => ["first"], schedule, { now: () => clock, budget });
  clock += 60_000; // Feed fetch and Groq generation do not spend delivery budget.
  const second = await dispatchApprovedPosts(async () => ["second", "third"], schedule, { now: () => clock, budget });
  assert.equal(first.scheduled, 1);
  assert.equal(second.scheduled, 1);
  assert.equal(second.deferred, 1);
  assert.equal(sent, 2);
  assert.equal(budget.remainingMs, 0);
});


test("only failed, uncertain, or unexpected outcomes signal a failed sync", () => {
  const ok = { selected: 3, scheduled: 1, failed: 0, needsReconciliation: 0, notClaimed: 1, errors: 0, deferred: 1 };
  assert.equal(hasDispatchFailures(ok), false);
  for (const field of ["failed", "needsReconciliation", "errors"] as const) {
    assert.equal(hasDispatchFailures(ok, { ...ok, [field]: 1 }), true);
  }
});


test("a failed Luma batch lookup remains visible to cron monitoring", async () => {
  const totals = { selected: 0, scheduled: 0, failed: 0, needsReconciliation: 0, notClaimed: 0, errors: 0, deferred: 0 };
  await recordDispatchBatch(totals, async () => ({ selected: 1, scheduled: 1, failed: 0, needsReconciliation: 0, notClaimed: 0, errors: 0, deferred: 0 }));
  await assert.rejects(() => recordDispatchBatch(totals, async () => { throw new Error("lookup failed"); }), /lookup failed/);
  assert.equal(totals.scheduled, 1);
  assert.equal(totals.errors, 1);
  assert.equal(hasDispatchFailures(totals), true);
});
