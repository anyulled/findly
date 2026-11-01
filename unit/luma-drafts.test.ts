import assert from "node:assert/strict";
import { test } from "node:test";
import { generateLumaEventDrafts, type ImportedLumaEvent, type LumaDraftRepository, type LumaDraftRow } from "../src/lib/luma-drafts";
import type { GenerationAccount } from "../src/lib/groq-workflow";
import type { ApprovedStyleExample, PostGenerationInput } from "../src/lib/groq";
import { selectEventAccounts } from "../src/lib/event-targets";

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
  assert.equal([...inserted.values()].every((row) => row.status === "review"), true);
  assert.equal(generated.length, 5);
  assert.equal(generated.some((input) => input.network === "LinkedIn" && input.reminderDays === 14), false);
  assert.equal(generated.find((input) => input.network === "LinkedIn")?.approvedExamples?.[0].text, example.text);
  assert.equal(generated.find((input) => input.network === "X")?.approvedExamples?.length, 0);
  assert.ok([...inserted.values()].every((row) => row.status === "review" && row.timezone === "Europe/Madrid"));
});

test("automatic Luma drafts are approved for dispatch, not added as style examples", async () => {
  const inserted = new Map<string, LumaDraftRow>();
  let schedulingPasses = 0;
  const repository: LumaDraftRepository = {
    async getPublishingMode() { return "automatic"; },
    async listLinkedAccounts() { return [{ id: "account-1", name: "Community", voice: "Informal", networks: ["LinkedIn"] }]; },
    async listExistingReminders() {
      return [...inserted.values()].map((row) => ({ accountId: row.account_id, network: row.network, leadDays: row.lead_days }));
    },
    async listApprovedExamples() { return []; },
    async insertDrafts(rows) {
      for (const row of rows) inserted.set(`${row.event_id}:${row.network}:${row.lead_days}`, row);
      return rows.length;
    },
    async scheduleAutomaticPosts(ownerId, eventId, accountIds) {
      assert.equal(ownerId, event.owner_id);
      assert.equal(eventId, event.id);
      assert.deepEqual(accountIds, ["account-1"]);
      schedulingPasses += 1;
    },
  };
  const generate = async (input: PostGenerationInput) => ({ text: `Join us on ${input.network}!` });

  const first = await generateLumaEventDrafts(event, repository, generate, new Date("2029-12-01T00:00:00.000Z"));
  const retry = await generateLumaEventDrafts(event, repository, generate, new Date("2029-12-01T00:00:00.000Z"));

  assert.equal(first, 3);
  assert.equal(retry, 0);
  assert.equal([...inserted.values()].every((row) => row.status === "approved"), true);
  assert.equal(schedulingPasses, 2);
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

test("source sync and automatic retries restrict generation and dispatch to source-linked accounts", async () => {
  const allAccounts: GenerationAccount[] = [
    { id: "jug", name: "Barcelona JUG", voice: "community", networks: ["LinkedIn", "X"] },
    { id: "personal", name: "Personal", voice: "personal", networks: ["LinkedIn"] },
    { id: "crafters", name: "Crafters", voice: "community", networks: ["Bluesky"] },
  ];
  for (const mode of ["review", "automatic"] as const) {
    const inserted: LumaDraftRow[] = [];
    const dispatched: string[] = [];
    const sentKeys = new Set<string>();
    const generatorAccounts: string[] = [];
    const repository: LumaDraftRepository = {
      async getPublishingMode() { return mode; },
      async listLinkedAccounts(_ownerId, sourceId) {
        return selectEventAccounts(allAccounts, sourceId, [{ sourceId: event.source_id ?? "source-1", accountId: "jug" }]);
      },
      async listExistingReminders() { return inserted.map((row) => ({ accountId: row.account_id, network: row.network, leadDays: row.lead_days })); },
      async listApprovedExamples(_ownerId, accountIds) { assert.deepEqual(accountIds, ["jug"]); return []; },
      async insertDrafts(rows) { inserted.push(...rows); return rows.length; },
      async scheduleAutomaticPosts(_ownerId, _eventId, accountIds) {
        assert.deepEqual(accountIds, ["jug"]);
        for (const row of inserted.filter((post) => accountIds.includes(post.account_id))) {
          const key = `${row.account_id}:${row.network}:${row.lead_days}`;
          if (!sentKeys.has(key)) { sentKeys.add(key); dispatched.push(row.account_id); }
        }
      },
    };
    const generate = async (input: PostGenerationInput) => { generatorAccounts.push(input.accountId); return { text: "Join us!" }; };
    assert.equal(await generateLumaEventDrafts(event, repository, generate, new Date("2029-12-01T00:00:00.000Z")), 6);
    assert.equal(await generateLumaEventDrafts(event, repository, generate, new Date("2029-12-01T00:00:00.000Z")), 0);
    assert.deepEqual(new Set(generatorAccounts), new Set(["jug"]));
    assert.deepEqual(new Set(inserted.map((row) => row.account_id)), new Set(["jug"]));
    assert.equal(dispatched.every((id) => id === "jug"), true);
    assert.equal(dispatched.length, mode === "automatic" ? 6 : 0);
  }
});


test("manual event generation and retry retain persisted target accounts", async () => {
  const manualEvent: ImportedLumaEvent = { ...event, source_id: null, target_account_ids: ["personal"] };
  const accounts: GenerationAccount[] = [
    { id: "personal", name: "Personal", voice: "personal", networks: ["LinkedIn"] },
    { id: "jug", name: "Barcelona JUG", voice: "community", networks: ["LinkedIn"] },
  ];
  const inserted: LumaDraftRow[] = [];
  const generated: string[] = [];
  let selections = 0;
  const repository: LumaDraftRepository = {
    async listLinkedAccounts(ownerId, sourceId, selectedAccountIds) {
      assert.equal(ownerId, manualEvent.owner_id);
      assert.equal(sourceId, null);
      assert.deepEqual(selectedAccountIds, ["personal"]);
      selections += 1;
      return selectEventAccounts(accounts, sourceId, [], selectedAccountIds);
    },
    async listExistingReminders() { return inserted.map((row) => ({ accountId: row.account_id, network: row.network, leadDays: row.lead_days })); },
    async listApprovedExamples(_ownerId, accountIds) { assert.deepEqual(accountIds, ["personal"]); return []; },
    async insertDrafts(rows) { inserted.push(...rows); return rows.length; },
  };
  const generate = async (input: PostGenerationInput) => { generated.push(input.accountId); return { text: "Join us!" }; };
  const now = new Date("2029-12-01T00:00:00.000Z");
  assert.equal(await generateLumaEventDrafts(manualEvent, repository, generate, now), 3);
  inserted.pop(); // Simulate one missing reminder after partial persistence.
  assert.equal(await generateLumaEventDrafts(manualEvent, repository, generate, now), 1);
  assert.equal(selections, 2);
  assert.deepEqual(new Set(generated), new Set(["personal"]));
  assert.deepEqual(new Set(inserted.map((row) => row.account_id)), new Set(["personal"]));
});

test("generation provenance and failure codes survive draft persistence without automatic approval", async () => {
  const inserted: LumaDraftRow[] = [];
  const repository: LumaDraftRepository = {
    async getPublishingMode() { return "automatic"; },
    async listLinkedAccounts() { return [{ id: "a", name: "Community", voice: "", networks: ["LinkedIn"] }]; },
    async listExistingReminders() { return []; },
    async listApprovedExamples() { return []; },
    async insertDrafts(rows) { inserted.push(...rows); return rows.length; },
    async scheduleAutomaticPosts() {},
  };
  const { generateSocialPostOrFallback } = await import("../src/lib/groq");
  await generateLumaEventDrafts(event, repository, (input) => generateSocialPostOrFallback(input, { apiKey: "", model: "" }), new Date("2029-12-01T00:00:00.000Z"));
  assert.equal(inserted.length, 3);
  assert.ok(inserted.every((row) => row.status === "review" && row.generation_origin === "fallback" && row.generation_error_code === "not_configured"));
  inserted.length = 0;
  await generateLumaEventDrafts(event, repository, async () => ({ text: "Groq text", model: "llama", validation: { valid: true, count: 9, limit: 3000, message: "ok" } }), new Date("2029-12-01T00:00:00.000Z"));
  assert.ok(inserted.every((row) => row.generation_origin === "groq" && row.generation_error_code === undefined && row.status === "approved"));
});

test("sets last_error on draft rows when fallback generator is used", async () => {
  const inserted: LumaDraftRow[] = [];
  const accounts: GenerationAccount[] = [
    { id: "personal", name: "Personal", voice: "personal", networks: ["LinkedIn"] },
  ];
  const repository: LumaDraftRepository = {
    async listLinkedAccounts() { return accounts; },
    async listExistingReminders() { return []; },
    async listApprovedExamples() { return []; },
    async insertDrafts(rows) { inserted.push(...rows); return rows.length; },
  };
  const generate = async () => ({
    text: "Fallback post",
    model: "fallback",
    provider: "fallback" as const,
    validation: { valid: true, count: 13, limit: 3000, message: "13 / 3000" },
  });
  const count = await generateLumaEventDrafts(event, repository, generate, new Date("2029-12-01T00:00:00.000Z"));
  assert.equal(count, 3);
  assert.equal(inserted.length, 3);
  assert.equal(
    inserted.every((row) => row.last_error === "Generado con plantilla de respaldo (la generación con IA no estuvo disponible o no superó la validación)."),
    true,
  );
});
