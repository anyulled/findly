import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isAuthorizedCronRequest, isCronSyncRequest } from "../src/lib/cron-auth";
import { fetchLumaFeed, syncLumaSources, type PersistableEvent, type SyncRepository } from "../src/lib/luma-sync";
import type { ImportedLumaEvent } from "../src/lib/luma-drafts";

const fixture = readFileSync(new URL("./fixtures/luma-sample.ics", import.meta.url), "utf8");

test("cron bearer authentication requires an exact constant-time comparable token", () => {
  assert.equal(isAuthorizedCronRequest(new Request("https://example.test", { headers: { authorization: "Bearer secret" } }), "secret"), true);
  assert.equal(isAuthorizedCronRequest(new Request("https://example.test", { headers: { authorization: "Bearer wrong" } }), "secret"), false);
  assert.equal(isAuthorizedCronRequest(new Request("https://example.test"), "secret"), false);
});

test("only POST to the exact cron endpoint bypasses browser-session auth", () => {
  assert.equal(isCronSyncRequest("POST", "/api/cron/sync"), true);
  assert.equal(isCronSyncRequest("GET", "/api/cron/sync"), false);
  assert.equal(isCronSyncRequest("POST", "/api/cron/sync/other"), false);
  assert.equal(isCronSyncRequest("POST", "/api/other"), false);
});

test("repeated sync inserts only new events and does not overwrite stored data", async () => {
  const stored = new Map<string, ImportedLumaEvent>();
  let feedReads = 0;
  const generatedEvents: string[] = [];
  const repository: SyncRepository = {
    async listEnabledLumaSources() { return [{ id: "source-1", ownerId: "owner-1", name: "Luma", feedUrl: "https://example.test/feed.ics" }]; },
    async upsertEvents(events) {
      const inserted: ImportedLumaEvent[] = [];
      for (const event of events) {
        const key = `${event.owner_id}:${event.source_id}:${event.external_id}`;
        if (!stored.has(key)) {
          const imported = { ...event, id: `event-${event.external_id}` };
          stored.set(key, imported);
          inserted.push(imported);
        }
      }
      const available = events.flatMap((event) => {
        const key = `${event.owner_id}:${event.source_id}:${event.external_id}`;
        const persisted = stored.get(key);
        return persisted ? [persisted] : [];
      });
      return { inserted, available };
    },
  };
  const fetchFeed = async () => { feedReads += 1; return fixture; };
  const generatedReminders = new Set<string>();
  const generateDrafts = async (_source: { id: string }, event: ImportedLumaEvent) => {
    if (generatedReminders.has(event.id)) return 0;
    generatedReminders.add(event.id);
    generatedEvents.push(event.id);
    return 2;
  };
  const first = await syncLumaSources(repository, fetchFeed, generateDrafts);
  const original = [...stored.values()][0];
  const second = await syncLumaSources(repository, fetchFeed, generateDrafts);
  assert.equal(first.eventsInserted, 3);
  assert.equal(first.draftsCreated, 6);
  assert.equal(second.eventsInserted, 0);
  assert.equal(second.draftsCreated, 0);
  assert.equal(stored.size, 3);
  assert.equal(stored.values().next().value, original);
  assert.equal(generatedEvents.length, 3);
  assert.equal(feedReads, 2);
});

test("a failed feed does not prevent other sources from importing", async () => {
  const inserted: PersistableEvent[] = [];
  const repository: SyncRepository = {
    async listEnabledLumaSources() { return [
      { id: "bad", ownerId: "owner-1", name: "Bad", feedUrl: "https://example.test/bad.ics" },
      { id: "good", ownerId: "owner-1", name: "Good", feedUrl: "https://example.test/good.ics" },
    ]; },
    async upsertEvents(events) {
      inserted.push(...events);
      const available = events.map((event) => ({ ...event, id: `event-${event.external_id}` }));
      return { inserted: available, available };
    },
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
    async upsertEvents(events) {
      const available = events.map((event) => ({ ...event, id: `event-${event.external_id}` }));
      return { inserted: available, available };
    },
  };
  const result = await syncLumaSources(repository, async () => fixture.replace("SUMMARY:AI Builders\\, Madrid", "SUMMARY:"));
  assert.equal(result.feedsSucceeded, 1);
  assert.equal(result.eventsInserted, 2);
  assert.deepEqual(result.issues, [{ sourceId: "source", code: "invalid_calendar", skippedEvents: 1 }]);
});

test("new events stay persisted without drafts when Groq is not configured", async () => {
  const repository: SyncRepository = {
    async listEnabledLumaSources() { return [{ id: "source", ownerId: "owner", name: "Luma", feedUrl: "https://example.test/feed.ics" }]; },
    async upsertEvents(events) {
      const available = events.map((event) => ({ ...event, id: `event-${event.external_id}` }));
      return { inserted: available, available };
    },
  };
  const result = await syncLumaSources(repository, async () => fixture);
  assert.equal(result.eventsInserted, 3);
  assert.equal(result.draftEventsSkipped, 3);
  assert.equal(result.draftsCreated, 0);
  assert.deepEqual(result.issues, []);
});

test("one event draft failure does not roll back imported events or stop later events", async () => {
  const repository: SyncRepository = {
    async listEnabledLumaSources() { return [{ id: "source", ownerId: "owner", name: "Luma", feedUrl: "https://example.test/feed.ics" }]; },
    async upsertEvents(events) {
      const available = events.map((event) => ({ ...event, id: `event-${event.external_id}` }));
      return { inserted: available, available };
    },
  };
  const generated: string[] = [];
  const result = await syncLumaSources(repository, async () => fixture, async (_source, event) => {
    generated.push(event.id);
    if (generated.length === 1) throw new Error("provider response contains private details");
    return 1;
  });
  assert.equal(result.eventsInserted, 3);
  assert.equal(result.draftEventsFailed, 1);
  assert.equal(result.draftsCreated, 2);
  assert.equal(generated.length, 3);
  assert.deepEqual(result.issues, [{ sourceId: "source", eventId: "event-utc-event@example.test", code: "draft_generation_failed" }]);
});

test("events skipped without Groq are retried later and reminders are generated only once", async () => {
  const stored = new Map<string, ImportedLumaEvent>();
  const generatedEventIds = new Set<string>();
  let generatedReminderCount = 0;
  const repository: SyncRepository = {
    async listEnabledLumaSources() { return [{ id: "source", ownerId: "owner", name: "Luma", feedUrl: "https://example.test/feed.ics" }]; },
    async upsertEvents(events) {
      const inserted: ImportedLumaEvent[] = [];
      for (const row of events) {
        const key = `${row.owner_id}:${row.source_id}:${row.external_id}`;
        if (!stored.has(key)) {
          const event = { ...row, id: `event-${row.external_id}` };
          stored.set(key, event);
          inserted.push(event);
        }
      }
      const available = events.flatMap((row) => {
        const key = `${row.owner_id}:${row.source_id}:${row.external_id}`;
        const event = stored.get(key);
        return event ? [event] : [];
      });
      return { inserted, available };
    },
  };
  const fetchFeed = async () => fixture;
  const withoutGroq = await syncLumaSources(repository, fetchFeed);
  const recovered = await syncLumaSources(repository, fetchFeed, async (_source, event) => {
    if (generatedEventIds.has(event.id)) return 0;
    generatedEventIds.add(event.id);
    generatedReminderCount += 3;
    return 3;
  });
  const repeated = await syncLumaSources(repository, fetchFeed, async (_source, event) => {
    if (generatedEventIds.has(event.id)) return 0;
    generatedEventIds.add(event.id);
    generatedReminderCount += 3;
    return 3;
  });

  assert.equal(withoutGroq.eventsInserted, 3);
  assert.equal(withoutGroq.draftEventsSkipped, 3);
  assert.equal(recovered.eventsInserted, 0);
  assert.equal(recovered.draftsCreated, 9);
  assert.equal(repeated.eventsInserted, 0);
  assert.equal(repeated.draftsCreated, 0);
  assert.equal(generatedReminderCount, 9);
  assert.equal(stored.size, 3);
});

test("fetchLumaFeed rejects invalid, private, unsuccessful, and oversized feeds", async () => {
  await assert.rejects(fetchLumaFeed("not a URL"), /Invalid feed URL/);
  await assert.rejects(fetchLumaFeed("http://example.test/feed.ics"), /must use HTTPS/);
  await assert.rejects(fetchLumaFeed("https://user:secret@example.test/feed.ics"), /must use HTTPS/);
  for (const host of ["localhost", "api.localhost", "printer.local", "127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.1.1", "172.16.0.1"]) {
    await assert.rejects(fetchLumaFeed(`https://${host}/feed.ics`), /Private feed host/);
  }

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    await assert.rejects(fetchLumaFeed("https://example.test/feed.ics"), /Feed request failed/);

    let declaredOversizeChunks = 0;
    let declaredOversizeCancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        declaredOversizeChunks += 1;
        controller.enqueue(new Uint8Array(1));
      },
      cancel() { declaredOversizeCancelled = true; },
    }, { highWaterMark: 0 }), { headers: { "content-length": "2000001" } });
    await assert.rejects(fetchLumaFeed("https://example.test/feed.ics"), /Feed is too large/);
    assert.equal(declaredOversizeChunks, 0);
    assert.equal(declaredOversizeCancelled, true);

    let chunksProduced = 0;
    let streamCancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksProduced += 1;
        controller.enqueue(new Uint8Array(1_000_000));
        if (chunksProduced === 5) controller.close();
      },
      cancel() { streamCancelled = true; },
    }));
    await assert.rejects(fetchLumaFeed("https://example.test/feed.ics"), /Feed is too large/);
    // ReadableStream may prefetch one queued chunk; the remaining body is cancelled.
    assert.ok(chunksProduced <= 4);
    assert.equal(streamCancelled, true);

    globalThis.fetch = async () => new Response("x", { headers: { "content-length": "2000001" } });
    await assert.rejects(fetchLumaFeed("https://example.test/feed.ics"), /Feed is too large/);

    const readFailure = new Error("stream broke");
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { controller.error(readFailure); },
    }));
    await assert.rejects(fetchLumaFeed("https://example.test/feed.ics"), /stream broke/);

    const utf8 = new TextEncoder().encode("BEGIN:VCALENDAR\nSUMMARY:café\nEND:VCALENDAR");
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const split = utf8.indexOf(0xc3) + 1;
        controller.enqueue(utf8.slice(0, split));
        controller.enqueue(utf8.slice(split));
        controller.close();
      },
    }));
    assert.equal(await fetchLumaFeed("https://example.test/feed.ics"), "BEGIN:VCALENDAR\nSUMMARY:café\nEND:VCALENDAR");

    globalThis.fetch = async () => new Response(fixture, { headers: { "content-length": String(Buffer.byteLength(fixture)) } });
    assert.equal(await fetchLumaFeed("https://example.test/feed.ics"), fixture);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
