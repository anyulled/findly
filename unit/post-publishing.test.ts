import assert from "node:assert/strict";
import test from "node:test";
import {
  approveAndSchedulePost,
  schedulePostWithSupabase,
  type PostToSchedule,
} from "../src/lib/post-publishing";

const post: PostToSchedule = {
  id: "post-uuid",
  attempt_id: "attempt-uuid",
  account_id: "account-uuid",
  network: "LinkedIn",
  due_at: "2026-11-07T12:00:00+00:00",
  content: "Join us next week!",
};

function bufferResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeSupabase(options: { channelId?: string; status?: string; confirmedPersistenceFails?: boolean; scheduledPost?: PostToSchedule } = {}) {
  const calls: string[] = [];
  process.env.BUFFER_API_KEY_PERSONAL = "mock-buffer-key";
  const rpcArguments: Array<{ name: string; args: Record<string, unknown> }> = [];
  let status = options.status ?? "approved";
  let bufferPostId: string | null = null;
  let lastError: string | null = null;
  let attemptId: string | null = null;
  let attempts = 0;

  function rpc(name: string, args: Record<string, unknown>) {
    calls.push(name);
    rpcArguments.push({ name, args });
    const execute = async () => {
      if (name === "claim_post_for_scheduling") {
        if ((status !== "approved" && status !== "failed") || bufferPostId) return { data: null, error: null };
        status = "scheduling";
        attemptId = `attempt-${++attempts}`;
        return { data: { ...(options.scheduledPost ?? post), attempt_id: attemptId }, error: null };
      }
      if ((name === "mark_post_scheduled" || name === "mark_post_scheduling_failure") &&
          (status !== "scheduling" || args.p_attempt_id !== attemptId)) {
        return { data: null, error: { message: "Post is not held by this scheduling attempt" } };
      }
      if (name === "mark_post_scheduled") {
        if (options.confirmedPersistenceFails) return { data: null, error: { message: "database unavailable" } };
        status = "scheduled";
        bufferPostId = String(args.p_buffer_post_id);
      } else if (name === "mark_post_scheduling_failure") {
        status = args.p_needs_reconciliation ? "needs_reconciliation" : "failed";
        lastError = String(args.p_error);
      }
      return { data: null, error: null };
    };
    return {
      maybeSingle: execute,
      then: (resolve: (value: Awaited<ReturnType<typeof execute>>) => unknown, reject?: (reason: unknown) => unknown) => execute().then(resolve, reject),
    };
  }

  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: options.channelId ? { buffer_channel_id: options.channelId } : null, error: null }) }),
            maybeSingle: async () => ({ data: { name: "Personal" }, error: null }),
          }),
        }),
      }),
    }),
    rpc,
  };

  return {
    supabase: supabase as unknown as Parameters<typeof schedulePostWithSupabase>[1],
    calls,
    rpcArguments,
    reconcileMissing() {
      if (status !== "needs_reconciliation") return false;
      status = "failed";
      return true;
    },
    get state() { return { status, bufferPostId, lastError }; },
  };
}

test("review approval records approval before Buffer scheduling and stores confirmed ID", async () => {
  const database = fakeSupabase({ channelId: "buffer-channel-1" });
  const result = await approveAndSchedulePost(
    post.id,
    post.content,
    database.supabase,
    "owner-uuid",
    async (_url, request) => {
      assert.equal(request?.headers && new Headers(request.headers).get("Authorization"), "Bearer mock-buffer-key");
      const body = JSON.parse(String(request?.body)) as { variables: { input: { channelId: string; dueAt: string; mode: string; text: string } } };
      assert.equal(body.variables.input.channelId, "buffer-channel-1");
      assert.equal(body.variables.input.dueAt, "2026-11-07T12:00:00.000Z");
      assert.equal(body.variables.input.mode, "customScheduled");
      assert.equal(body.variables.input.text, post.content);
      return bufferResponse({ data: { createPost: { __typename: "PostActionSuccess", post: { id: "buffer-post-1", text: post.content } } } });
    },
  );

  assert.equal(result.kind, "scheduled");
  assert.deepEqual(database.calls, ["approve_post", "claim_post_for_scheduling", "mark_post_scheduled"]);
  assert.equal(database.rpcArguments.find((call) => call.name === "claim_post_for_scheduling")?.args.p_owner_id, "owner-uuid");
  assert.equal(database.rpcArguments.find((call) => call.name === "mark_post_scheduled")?.args.p_owner_id, "owner-uuid");
  assert.equal(database.rpcArguments.find((call) => call.name === "mark_post_scheduled")?.args.p_attempt_id, "attempt-1");
  assert.deepEqual(database.state, { status: "scheduled", bufferPostId: "buffer-post-1", lastError: null });
});

test("automatic dispatch claims a generated post without invoking review approval", async () => {
  const database = fakeSupabase({ channelId: "buffer-channel-1" });
  const result = await schedulePostWithSupabase(
    post.id,
    database.supabase,
    "owner-uuid",
    async () => bufferResponse({ data: { createPost: { __typename: "PostActionSuccess", post: { id: "buffer-post-2", text: post.content } } } }),
  );
  assert.equal(result.kind, "scheduled");
  assert.equal(database.calls.includes("approve_post"), false);
  assert.equal(database.state.status, "scheduled");
});

test("a database failure after Buffer confirmation requires reconciliation, never retry", async () => {
  const database = fakeSupabase({ channelId: "buffer-channel-1", confirmedPersistenceFails: true });
  let requests = 0;
  const fetchImpl: typeof fetch = async () => {
    requests += 1;
    return bufferResponse({ data: { createPost: { __typename: "PostActionSuccess", post: { id: "buffer-post-3", text: post.content } } } });
  };
  const first = await schedulePostWithSupabase(post.id, database.supabase, "owner-uuid", fetchImpl);
  const second = await schedulePostWithSupabase(post.id, database.supabase, "owner-uuid", fetchImpl);
  assert.equal(first.kind, "needs_reconciliation");
  assert.equal(second.kind, "not_claimed");
  assert.equal(database.state.status, "needs_reconciliation");
  assert.equal(requests, 1);
});

test("Buffer rejection is stored as failed and can be safely retried after correction", async () => {
  const database = fakeSupabase({ channelId: "buffer-channel-1" });
  const result = await schedulePostWithSupabase(
    post.id,
    database.supabase,
    "owner-uuid",
    async () => bufferResponse({ data: { createPost: { __typename: "MutationError", message: "Channel rejected this post" } } }),
  );
  assert.equal(result.kind, "failed");
  assert.equal(database.state.status, "failed");
  assert.equal(database.state.lastError, "Channel rejected this post");
});

test("a transport timeout becomes reconciliation-required and a second dispatch cannot duplicate", async () => {
  const database = fakeSupabase({ channelId: "buffer-channel-1" });
  let requests = 0;
  const fetchImpl: typeof fetch = async () => {
    requests += 1;
    throw new Error("connection reset");
  };
  const first = await schedulePostWithSupabase(post.id, database.supabase, "owner-uuid", fetchImpl);
  const second = await schedulePostWithSupabase(post.id, database.supabase, "owner-uuid", fetchImpl);
  assert.equal(first.kind, "needs_reconciliation");
  assert.equal(second.kind, "not_claimed");
  assert.equal(database.state.status, "needs_reconciliation");
  assert.equal(requests, 1);
});

test("a missing account/network channel fails before calling Buffer", async () => {
  const database = fakeSupabase();
  let requests = 0;
  const result = await schedulePostWithSupabase(post.id, database.supabase, "owner-uuid", async () => {
    requests += 1;
    return bufferResponse({});
  });
  assert.equal(result.kind, "failed");
  assert.equal(database.state.status, "failed");
  assert.equal(requests, 0);
});

test("persisted text is validated deterministically before Buffer is called", async () => {
  const tooLongPost = { ...post, network: "X", content: "x".repeat(281) };
  const database = fakeSupabase({ channelId: "buffer-channel-1", scheduledPost: tooLongPost });
  let requests = 0;
  const result = await schedulePostWithSupabase(post.id, database.supabase, "owner-uuid", async () => {
    requests += 1;
    return bufferResponse({});
  });
  assert.equal(result.kind, "failed");
  assert.equal(database.state.status, "failed");
  assert.equal(requests, 0);
});


test("an in-flight Buffer request cannot be released and retried by another session", async () => {
  const database = fakeSupabase({ channelId: "buffer-channel-1" });
  let requests = 0;
  let signalStarted!: () => void;
  let finishResponse!: (response: Response) => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const pendingResponse = new Promise<Response>((resolve) => { finishResponse = resolve; });
  const fetchImpl: typeof fetch = async () => {
    requests += 1;
    signalStarted();
    return pendingResponse;
  };
  const first = schedulePostWithSupabase(post.id, database.supabase, "owner-uuid", fetchImpl);
  await started;
  assert.equal(database.state.status, "scheduling");
  assert.equal(database.reconcileMissing(), false);
  const second = await schedulePostWithSupabase(post.id, database.supabase, "owner-uuid", fetchImpl);
  assert.equal(second.kind, "not_claimed");
  assert.equal(requests, 1);
  finishResponse(bufferResponse({ data: { createPost: { __typename: "PostActionSuccess", post: { id: "only-buffer-post", text: post.content } } } }));
  assert.equal((await first).kind, "scheduled");
  assert.equal(database.state.bufferPostId, "only-buffer-post");
});

test("the Supabase repository sends the active attempt ID when recording failure", async () => {
  const database = fakeSupabase({ channelId: "buffer-channel-1" });
  await schedulePostWithSupabase(post.id, database.supabase, "owner-uuid", async () => { throw new Error("timeout"); });
  assert.equal(database.rpcArguments.find((call) => call.name === "mark_post_scheduling_failure")?.args.p_attempt_id, "attempt-1");
});
