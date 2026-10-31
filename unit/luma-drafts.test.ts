import assert from "node:assert/strict";
import { test } from "node:test";
import { generateLumaEventDrafts, type ImportedLumaEvent, type LumaDraftRepository, type LumaDraftRow } from "../src/lib/luma-drafts";
import type { GenerationAccount } from "../src/lib/groq-workflow";
import type { ApprovedStyleExample, PostGenerationInput } from "../src/lib/groq";

const event: ImportedLumaEvent = {
  id: "event-1",
  owner_id: "owner-1",
  source_id: "source-1",
  external_id: "luma-uid-1",
  title: "Community event",
  starts_at: "2030-01-20T18:00:00.000Z",
  location: "Barcelona",
  description: "Meet the community",
  event_url: "https://lu.ma/example",
  detected_language: "en",
};

test("Luma drafts use linked accounts and approved examples and remain idempotent", async () => {
  const accounts: GenerationAccount[] = [{ id: "account-1", name: "Community", voice: "Informal", networks: ["LinkedIn", "X"] }];
  const example: ApprovedStyleExample = { accountId: "account-1", network: "LinkedIn", language: "en", text: "Come join our community!" };
  const inserted = new Map<string, LumaDraftRow>();
  const generated: PostGenerationInput[] = [];
  const repository: LumaDraftRepository = {
    async listLinkedAccounts(ownerId, sourceId) {
      assert.equal(ownerId, event.owner_id);
      assert.equal(sourceId, event.source_id);
      return accounts;
    },
    async listExistingReminders(ownerId, eventId) {
      assert.equal(ownerId, event.owner_id);
      assert.equal(eventId, event.id);
      return [
        { accountId: "account-1", network: "LinkedIn", leadDays: 14 },
        ...[...inserted.values()].map((row) => ({ accountId: row.account_id, network: row.network, leadDays: row.lead_days })),
      ];
    },
    async listApprovedExamples(ownerId, accountIds) {
      assert.equal(ownerId, event.owner_id);
      assert.deepEqual(accountIds, ["account-1"]);
      return [example];
    },
    async insertDrafts(rows) {
      let count = 0;
      for (const row of rows) {
        const key = `${row.event_id}:${row.account_id}:${row.network}:${row.lead_days}`;
        if (!inserted.has(key)) { inserted.set(key, row); count += 1; }
      }
      return count;
    },
  };
  const generate = async (input: PostGenerationInput) => {
    generated.push(input);
    return { text: `Join us on ${input.network}!` };
  };

  const first = await generateLumaEventDrafts(event, repository, generate, new Date("2029-12-01T00:00:00.000Z"));
  const second = await generateLumaEventDrafts(event, repository, generate, new Date("2029-12-01T00:00:00.000Z"));

  assert.equal(first, 5);
  assert.equal(second, 0);
  assert.equal(inserted.size, 5);
  assert.equal(generated.length, 5);
  assert.equal(generated.some((input) => input.network === "LinkedIn" && input.reminderDays === 14), false);
  assert.equal(generated.find((input) => input.network === "LinkedIn")?.approvedExamples?.[0].text, example.text);
  assert.equal(generated.find((input) => input.network === "X")?.approvedExamples?.length, 0);
  assert.ok([...inserted.values()].every((row) => row.status === "review" && row.timezone === "Europe/Madrid"));
});

test("Luma event with no linked accounts is persisted without requesting text", async () => {
  let generationCalled = false;
  const repository: LumaDraftRepository = {
    async listLinkedAccounts() { return []; },
    async listExistingReminders() { return []; },
    async listApprovedExamples() { return []; },
    async insertDrafts() { return 0; },
  };
  const count = await generateLumaEventDrafts(event, repository, async () => {
    generationCalled = true;
    return { text: "unused" };
  });
  assert.equal(count, 0);
  assert.equal(generationCalled, false);
});
