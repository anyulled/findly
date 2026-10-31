import assert from "node:assert/strict";
import test from "node:test";
import { hasMissingReminders, selectEventAccounts } from "../src/lib/event-targets";
import { generateEventDrafts, type GenerationAccount } from "../src/lib/groq-workflow";

const accounts = [
  { id: "personal", enabled: true, name: "Personal", voice: "personal", networks: ["LinkedIn", "X"] },
  { id: "jug", enabled: true, name: "Barcelona JUG", voice: "community", networks: ["LinkedIn", "X"] },
  { id: "crafters", enabled: true, name: "Software Crafters", voice: "community", networks: ["Bluesky"] },
  { id: "disabled", enabled: false, name: "Disabled", voice: "", networks: ["X"] },
] satisfies (GenerationAccount & { enabled: boolean })[];
const links = [
  { sourceId: "jug-source", accountId: "jug" },
  { sourceId: "other-source", accountId: "personal" },
  { sourceId: "jug-source", accountId: "disabled" },
];

test("source selection is fail-closed and manual events use enabled accounts", () => {
  assert.deepEqual(selectEventAccounts(accounts, "jug-source", links).map((account) => account.id), ["jug"]);
  assert.deepEqual(selectEventAccounts(accounts, "unlinked-source", links), []);
  assert.deepEqual(selectEventAccounts(accounts, null, links).map((account) => account.id), ["personal", "jug", "crafters"]);
  assert.deepEqual(selectEventAccounts([{ id: undefined, name: "demo" }], undefined, []), [{ id: undefined, name: "demo" }]);
  assert.deepEqual(selectEventAccounts([{ id: undefined, name: "demo" }], "jug-source", links), []);
});

test("source retry generates missing drafts only for linked accounts", async () => {
  const eligible = selectEventAccounts(accounts, "jug-source", links);
  const sent: string[] = [];
  const drafts = await generateEventDrafts({
    event: { id: "event", title: "Community", date: "2030-01-20", time: "19:00", place: "Barcelona", description: "Talk" },
    accounts: eligible,
    approvedExamples: [],
    existing: [{ accountId: "jug", network: "LinkedIn", leadDays: 14 }],
    now: new Date("2029-12-01T00:00:00.000Z"),
    generate: async (input) => { sent.push(input.accountId); return { text: "Join us!" }; },
  });
  assert.equal(drafts.length, 5);
  assert.deepEqual(new Set(drafts.map((draft) => draft.accountId)), new Set(["jug"]));
  assert.deepEqual(new Set(sent), new Set(["jug"]));
});

test("missing reminders compare eligible account/network/offset keys, not total posts", () => {
  const eligible = selectEventAccounts(accounts, "jug-source", links);
  const complete = [14, 7, 1].flatMap((leadDays) => ["LinkedIn", "X"].map((network) => ({ accountId: "jug", network, leadDays })));
  assert.equal(hasMissingReminders(eligible, [14, 7, 1], complete), false);
  const extras = Array.from({ length: 10 }, () => ({ accountId: "personal", network: "LinkedIn", leadDays: 14 }));
  assert.equal(hasMissingReminders(eligible, [14, 7, 1], [...complete.slice(1), ...extras]), true);
  assert.equal(hasMissingReminders([], [14], []), false);
  assert.equal(hasMissingReminders(eligible, [], []), false);
});
