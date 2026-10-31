import assert from "node:assert/strict";
import test from "node:test";
import { dispatchApprovedPosts } from "../src/lib/approved-dispatch";
import { generateLumaEventDrafts, type ImportedLumaEvent, type LumaDraftRepository, type LumaDraftRow } from "../src/lib/luma-drafts";
import { generateEventDrafts, type GenerationAccount } from "../src/lib/groq-workflow";
import { madridDateTimeToIso } from "../src/lib/madrid-time";
import type { ApprovedStyleExample, PostGenerationInput } from "../src/lib/groq";
import type { PostPublishingOutcome } from "../src/lib/post-publishing";

const now = new Date("2099-09-01T00:00:00Z");
const account: GenerationAccount = { id: "jug", name: "Barcelona JUG", voice: "Informal", networks: ["LinkedIn"] };
const examples: ApprovedStyleExample[] = [{ accountId: "jug", network: "LinkedIn", language: "en", text: "Previously approved example" }];
const lumaEvent: ImportedLumaEvent = {
  id: "luma-event", owner_id: "owner", source_id: "source", external_id: "uid",
  title: "Community event", starts_at: "2099-10-20T18:00:00Z", location: "Barcelona",
  description: "Meet the community", event_url: "https://lu.ma/event", detected_language: "en",
};
type State = "approved" | "scheduled" | "scheduling" | "needs_reconciliation";
type Stored = { id: string; row: LumaDraftRow; state: State; remoteId?: string };

function fakePersistedWorkspace() {
  const records = new Map<string, Stored>();
  const remoteRequests: string[] = [];
  const savedExamples = [...examples];
  let groqRequests = 0;

  function key(row: LumaDraftRow) { return `${row.event_id}:${row.account_id}:${row.network}:${row.lead_days}`; }
  function insert(rows: LumaDraftRow[]) {
    let count = 0;
    for (const row of rows) {
      const id = key(row);
      if (!records.has(id)) {
        records.set(id, { id, row, state: "approved" });
        count += 1;
      }
    }
    return count;
  }
  function existing(eventId: string) {
    return [...records.values()].filter(({ row }) => row.event_id === eventId)
      .map(({ row }) => ({ accountId: row.account_id, network: row.network, leadDays: row.lead_days }));
  }
  async function generate(input: PostGenerationInput) {
    groqRequests += 1;
    return { text: `Join ${input.event.title} in ${input.reminderDays} days!` };
  }
  async function schedule(id: string): Promise<PostPublishingOutcome> {
    const post = records.get(id);
    assert.ok(post);
    if (post.state !== "approved") return { kind: "not_claimed" };
    post.state = "scheduling";
    // Simulated Buffer accepts one remote post. The persisted status acts as
    // the claim, so later recovery cannot send this intent a second time.
    remoteRequests.push(id);
    post.remoteId = `buffer-${id}`;
    post.state = "scheduled";
    return { kind: "scheduled", bufferPostId: post.remoteId };
  }
  async function recover() {
    return dispatchApprovedPosts(
      async () => [...records.values()].filter((post) => post.state === "approved").map((post) => post.id),
      schedule,
    );
  }
  function protectOtherAttempts() {
    const row: LumaDraftRow = {
      owner_id: "owner", event_id: "another-event", account_id: "jug", network: "LinkedIn", lead_days: 14,
      due_at: "2099-10-06T11:00:00Z", timezone: "Europe/Madrid", content: "other", status: "approved", language: "en",
    };
    records.set("uncertain", { id: "uncertain", row, state: "needs_reconciliation" });
    records.set("in-flight", { id: "in-flight", row, state: "scheduling" });
  }
  return { records, remoteRequests, savedExamples, insert, existing, generate, schedule, recover, protectOtherAttempts, get groqRequests() { return groqRequests; } };
}

for (const beforeInterruption of [0, 1]) {
  test(`Luma automatic recovery after ${beforeInterruption} confirmed deliveries preserves each persisted intent`, async () => {
    const workspace = fakePersistedWorkspace();
    let interrupt = true;
    const repository: LumaDraftRepository = {
      async getPublishingMode() { return "automatic"; },
      async listLinkedAccounts(ownerId, sourceId) {
        assert.equal(ownerId, "owner");
        assert.equal(sourceId, "source");
        return [account];
      },
      async listExistingReminders(_ownerId, eventId) { return workspace.existing(eventId); },
      async listApprovedExamples() { return workspace.savedExamples; },
      async insertDrafts(rows) { return workspace.insert(rows); },
      async scheduleAutomaticPosts() {
        if (interrupt) {
          if (beforeInterruption === 1) await workspace.schedule([...workspace.records.keys()][0]);
          throw new Error("simulated process termination after persist");
        }
        await workspace.recover();
      },
    };

    await assert.rejects(() => generateLumaEventDrafts(lumaEvent, repository, workspace.generate, now), /simulated process termination/);
    assert.equal(workspace.records.size, 3);
    assert.equal(workspace.remoteRequests.length, beforeInterruption);
    const previousExamples = structuredClone(workspace.savedExamples);
    workspace.protectOtherAttempts();
    interrupt = false;

    const firstRecovery = await workspace.recover();
    assert.equal(firstRecovery.scheduled, 3 - beforeInterruption);
    assert.equal((await workspace.recover()).selected, 0);
    assert.equal(await generateLumaEventDrafts(lumaEvent, repository, workspace.generate, now), 0);
    assert.equal(workspace.groqRequests, 3);
    assert.equal(workspace.remoteRequests.length, 3);
    assert.equal(new Set(workspace.remoteRequests).size, 3);
    assert.equal(workspace.records.get("uncertain")?.state, "needs_reconciliation");
    assert.equal(workspace.records.get("in-flight")?.state, "scheduling");
    assert.deepEqual(workspace.savedExamples, previousExamples);
  });
}

test("manual automatic reminders recover after persistence and do not regenerate or duplicate posts", async () => {
  const workspace = fakePersistedWorkspace();
  const manualEvent = {
    id: "manual-event", title: "Community event", date: "2099-10-20", time: "19:00", place: "Barcelona",
    description: "Meet the community", url: "https://lu.ma/event", language: "en" as const,
  };
  const generateMissing = () => generateEventDrafts({
    event: manualEvent, accounts: [account], approvedExamples: workspace.savedExamples,
    existing: workspace.existing(manualEvent.id), now, generate: workspace.generate,
  });

  const drafts = await generateMissing();
  const rows: LumaDraftRow[] = drafts.map((draft) => ({
    owner_id: "owner", event_id: manualEvent.id, account_id: draft.accountId,
    network: draft.network, lead_days: draft.leadDays, due_at: madridDateTimeToIso(draft.date, draft.time),
    timezone: "Europe/Madrid", content: draft.text, status: "approved", language: draft.language,
  }));
  assert.equal(workspace.insert(rows), 3);
  // Simulate the process stopping immediately after its committed upsert.
  assert.equal(workspace.remoteRequests.length, 0);
  const previousExamples = structuredClone(workspace.savedExamples);
  workspace.protectOtherAttempts();

  const firstRecovery = await workspace.recover();
  assert.equal(firstRecovery.scheduled, 3);
  assert.equal((await workspace.recover()).selected, 0);
  assert.equal((await generateMissing()).length, 0);
  assert.equal(workspace.insert(rows), 0);
  assert.equal(workspace.groqRequests, 3);
  assert.equal(workspace.remoteRequests.length, 3);
  assert.equal(new Set(workspace.remoteRequests).size, 3);
  assert.equal(workspace.records.get("uncertain")?.state, "needs_reconciliation");
  assert.equal(workspace.records.get("in-flight")?.state, "scheduling");
  assert.deepEqual(workspace.savedExamples, previousExamples);
});
