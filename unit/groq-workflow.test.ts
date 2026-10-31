import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateEventDrafts, type GenerationAccount } from "../src/lib/groq-workflow";
import type { PostGenerationInput } from "../src/lib/groq";

const event = {
  id: "event-1",
  title: "Comunidad Web",
  date: "2026-12-20",
  time: "19:00",
  place: "Barcelona",
  description: "Una tarde para compartir ideas.",
  source: "Manual",
  url: "https://example.org/event",
  language: "es" as const,
};

const accounts: GenerationAccount[] = [
  { id: "account-1", name: "Personal", voice: "Cercano y curioso.", networks: ["LinkedIn", "X"] },
  { id: "account-2", name: "Comunidad", voice: "Entusiasta y concreto.", networks: ["Bluesky"] },
];

describe("generateEventDrafts", () => {
  it("creates only future reminders with account, platform, language, and matching approved examples", async () => {
    const inputs: PostGenerationInput[] = [];
    const drafts = await generateEventDrafts({
      event,
      accounts,
      approvedExamples: [
        { accountId: "account-1", network: "X", language: "es", text: "Muestra de X aprobada." },
        { accountId: "account-1", network: "LinkedIn", language: "es", text: "Muestra de LinkedIn aprobada." },
        { accountId: "account-2", network: "Bluesky", language: "es", text: "Muestra de otra cuenta." },
      ],
      existing: [{ accountId: "account-1", network: "X", leadDays: 14 }],
      now: new Date("2026-12-01T00:00:00.000Z"),
      generate: async (input) => {
        inputs.push(input);
        return { text: `${input.network} ${input.reminderDays} ${input.accountId}` };
      },
    });

    assert.equal(drafts.length, 8);
    assert.equal(drafts.some((draft) => draft.accountId === "account-1" && draft.network === "X" && draft.leadDays === 14), false);
    assert.equal(drafts.every((draft) => draft.language === "es" && draft.time === "13:00" && draft.status === "review"), true);
    assert.equal(drafts.some((draft) => draft.leadDays === 1), true);
    assert.equal(inputs.find((input) => input.network === "X")?.approvedExamples?.[0]?.text, "Muestra de X aprobada.");
    assert.equal(inputs.some((input) => input.accountId === "account-1" && input.approvedExamples?.some((example) => example.text === "Muestra de otra cuenta.")), false);
    assert.equal(new Set(inputs.map((input) => input.accountId)).size, 2);
  });

  it("rejects an event that would generate too many posts for one request", async () => {
    const manyAccounts = Array.from({ length: 9 }, (_, index) => ({
      id: `account-${index}`,
      name: `Account ${index}`,
      voice: "",
      networks: ["LinkedIn", "X", "Bluesky"] as GenerationAccount["networks"],
    }));
    await assert.rejects(generateEventDrafts({
      event,
      accounts: manyAccounts,
      approvedExamples: [],
      existing: [],
      now: new Date("2026-11-01T00:00:00.000Z"),
      generate: async () => ({ text: "draft" }),
    }), /too many posts/u);
  });

  it("allows the maximum configured 3 accounts × 3 networks × 3 reminders", async () => {
    const maximumAccounts = Array.from({ length: 3 }, (_, index) => ({
      id: `account-${index}`,
      name: `Account ${index}`,
      voice: "",
      networks: ["LinkedIn", "X", "Bluesky"] as GenerationAccount["networks"],
    }));
    const drafts = await generateEventDrafts({
      event,
      accounts: maximumAccounts,
      approvedExamples: [],
      existing: [],
      now: new Date("2026-11-01T00:00:00.000Z"),
      generate: async () => ({ text: "draft" }),
    });
    assert.equal(drafts.length, 27);
  });

  it("keeps only reminders whose Madrid posting time is still in the future", async () => {
    const drafts = await generateEventDrafts({
      event: { ...event, date: "2026-12-12" },
      accounts: [accounts[0]],
      approvedExamples: [],
      existing: [],
      now: new Date("2026-12-05T13:00:00.000Z"),
      generate: async () => ({ text: "draft" }),
    });

    assert.deepEqual(drafts.map(({ leadDays }) => leadDays), [1, 1]);
    assert.deepEqual(drafts.map(({ date }) => date), ["2026-12-11", "2026-12-11"]);
  });

  it("stops starting more Groq requests after a generation fails", async () => {
    let started = 0;
    await assert.rejects(generateEventDrafts({
      event,
      accounts: [accounts[0]],
      approvedExamples: [],
      existing: [],
      now: new Date("2026-12-01T00:00:00.000Z"),
      generate: async () => {
        started += 1;
        if (started === 1) throw new Error("mock failure");
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { text: "draft" };
      },
    }), /mock failure/u);

    assert.equal(started, 4);
  });
});
