import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isAuthorizedCronRequest } from "../src/lib/cron-auth";
import { syncLumaSources, type PersistableEvent, type SyncRepository } from "../src/lib/luma-sync";

const fixture = readFileSync(new URL("./fixtures/luma-sample.ics", import.meta.url), "utf8");

test("cron bearer authentication requires an exact constant-time comparable token", () => {
  assert.equal(isAuthorizedCronRequest(new Request("https://example.test", { headers: { authorization: "Bearer secret" } }), "secret"), true);
  assert.equal(isAuthorizedCronRequest(new Request("https://example.test", { headers: { authorization: "Bearer wrong" } }), "secret"), false);
  assert.equal(isAuthorizedCronRequest(new Request("https://example.test"), "secret"), false);
});

test("repeated sync inserts only new events and does not overwrite stored data", async () => {
  const stored = new Map<string, PersistableEvent>();
  let feedReads = 0;
  const repository: SyncRepository = {
    async listEnabledLumaSources() { return [{ id: "source-1", ownerId: "owner-1", name: "Luma", feedUrl: "https://example.test/feed.ics" }]; },
    async insertEvents(events) {
      let inserted = 0;
      for (const event of events) {
        const key = `${event.owner_id}:${event.source_id}:${event.external_id}`;
        if (!stored.has(key)) { stored.set(key, event); inserted += 1; }
      }
      return inserted;
    },
  };
  const fetchFeed = async () => { feedReads += 1; return fixture; };
  const first = await syncLumaSources(repository, fetchFeed);
  const original = [...stored.values()][0];
  const second = await syncLumaSources(repository, fetchFeed);
  assert.equal(first.eventsInserted, 3);
  assert.equal(second.eventsInserted, 0);
  assert.equal(stored.size, 3);
  assert.equal(stored.values().next().value, original);
  assert.equal(feedReads, 2);
});

test("a failed feed does not prevent other sources from importing", async () => {
  const inserted: PersistableEvent[] = [];
  const repository: SyncRepository = {
    async listEnabledLumaSources() { return [
      { id: "bad", ownerId: "owner-1", name: "Bad", feedUrl: "https://example.test/bad.ics" },
      { id: "good", ownerId: "owner-1", name: "Good", feedUrl: "https://example.test/good.ics" },
    ]; },
    async insertEvents(events) { inserted.push(...events); return events.length; },
  };
  const result = await syncLumaSources(repository, async (url) => {
    if (url.endsWith("bad.ics")) throw new Error("network failure");
    return fixture;
  });
  assert.equal(result.sources, 2);
  assert.equal(result.feedsFailed, 1);
  assert.equal(result.feedsSucceeded, 1);
  assert.equal(result.eventsInserted, 3);
  assert.deepEqual(result.issues, [{ sourceId: "bad", code: "feed_unavailable" }]);
  assert.equal(inserted[0].source_id, "good");
});

test("malformed event records are reported without rejecting valid records", async () => {
  const repository: SyncRepository = {
    async listEnabledLumaSources() { return [{ id: "source", ownerId: "owner", name: "Luma", feedUrl: "https://example.test/feed.ics" }]; },
    async insertEvents(events) { return events.length; },
  };
  const result = await syncLumaSources(repository, async () => fixture.replace("SUMMARY:AI Builders\\, Madrid", "SUMMARY:"));
  assert.equal(result.feedsSucceeded, 1);
  assert.equal(result.eventsInserted, 2);
  assert.deepEqual(result.issues, [{ sourceId: "source", code: "invalid_calendar", skippedEvents: 1 }]);
});
