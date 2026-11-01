import { detectTitleLanguage } from "./language";
import { parseLumaIcal, type LumaCalendarEvent } from "./luma-ical";
import type { ImportedLumaEvent } from "./luma-drafts";
import { isSubstackUrl, normalizeSubstackPostsApiUrl, packLocationAndImage, parseSubstackFeed } from "./substack";
import { enrichMeetupRssItems, isMeetupUrl, normalizeMeetupRssUrl, parseMeetupFeed, parseMeetupRssFeed } from "./meetup";
import { logger } from "./logger";

export type LumaSource = { id: string; ownerId: string; name: string; feedUrl: string };
export type PersistableEvent = {
  owner_id: string; source_id: string; external_id: string; title: string;
  starts_at: string; timezone: "Europe/Madrid"; location: string; description: string;
  event_url: string | null; detected_language: "en" | "es" | "ca";
};
export type SyncRepository = {
  listEnabledLumaSources(): Promise<LumaSource[]>;
  upsertEvents(events: PersistableEvent[]): Promise<{ inserted: ImportedLumaEvent[]; available: ImportedLumaEvent[] }>;
};
export type FeedFetcher = (url: string) => Promise<string>;
export type DraftGenerator = (source: LumaSource, event: ImportedLumaEvent) => Promise<number>;

export type SyncResult = {
  sources: number; feedsSucceeded: number; feedsFailed: number; eventsInserted: number;
  draftsCreated: number; draftEventsSkipped: number; draftEventsFailed: number;
  issues: Array<{ sourceId: string; eventId?: string; code: "feed_unavailable" | "invalid_calendar" | "database_error" | "draft_generation_failed"; skippedEvents?: number }>;
};

function parseSourceRows(source: LumaSource, rawContent: string): { rows: PersistableEvent[]; skippedEvents: number } {
  if (isSubstackUrl(source.feedUrl)) {
    const items = parseSubstackFeed(rawContent, source.feedUrl).slice(0, 5);
    const rows = items.map((item): PersistableEvent => ({
      owner_id: source.ownerId,
      source_id: source.id,
      external_id: item.uid,
      title: item.title,
      starts_at: item.publishedAt,
      timezone: "Europe/Madrid",
      location: packLocationAndImage("", item.coverImage),
      description: item.description,
      event_url: item.url,
      detected_language: detectTitleLanguage(item.title),
    }));
    return { rows, skippedEvents: 0 };
  }
  if (isMeetupUrl(source.feedUrl)) {
    const items = parseMeetupFeed(rawContent, source.feedUrl);
    const validItems = items.filter((item): item is typeof item & { startsAt: string } => Boolean(item.startsAt));
    const rows = validItems.map((item): PersistableEvent => ({
      owner_id: source.ownerId,
      source_id: source.id,
      external_id: item.uid,
      title: item.title,
      starts_at: item.startsAt,
      timezone: "Europe/Madrid",
      location: packLocationAndImage(item.location, item.coverImage),
      description: item.description,
      event_url: item.url,
      detected_language: detectTitleLanguage(item.title),
    }));
    return { rows, skippedEvents: items.length - validItems.length };
  }
  const parsed = parseLumaIcal(rawContent);
  const rows = parsed.events.map((event: LumaCalendarEvent): PersistableEvent => ({
    owner_id: source.ownerId, source_id: source.id, external_id: event.uid, title: event.title,
    starts_at: event.startsAt, timezone: "Europe/Madrid", location: event.location,
    description: event.description, event_url: event.url, detected_language: detectTitleLanguage(event.title),
  }));
  return { rows, skippedEvents: parsed.issues.length };
}

async function generateDraftsForPersistedEvents(
  source: LumaSource,
  persisted: { inserted: ImportedLumaEvent[]; available: ImportedLumaEvent[] },
  generateDrafts: DraftGenerator | undefined,
  result: SyncResult,
): Promise<void> {
  const newlyInsertedIds = new Set(persisted.inserted.map((event) => event.id));
  for (const event of persisted.available) {
    if (!generateDrafts) {
      if (newlyInsertedIds.has(event.id)) result.draftEventsSkipped += 1;
      continue;
    }
    try {
      result.draftsCreated += await generateDrafts(source, event);
    } catch (error) {
      logger.warn("Failed to generate drafts for event during sync", { sourceId: source.id, eventId: event.id }, error);
      result.draftEventsFailed += 1;
      result.issues.push({ sourceId: source.id, eventId: event.id, code: "draft_generation_failed" });
    }
  }
}

async function syncSingleSource(
  source: LumaSource,
  fetchFeed: FeedFetcher,
  repository: SyncRepository,
  generateDrafts: DraftGenerator | undefined,
  result: SyncResult,
): Promise<void> {
  let parsed: { rows: PersistableEvent[]; skippedEvents: number };
  try {
    parsed = parseSourceRows(source, await fetchFeed(source.feedUrl));
    result.feedsSucceeded += 1;
  } catch (error) {
    logger.warn("Failed to fetch or parse feed for source", { sourceId: source.id, feedUrl: source.feedUrl }, error);
    result.feedsFailed += 1;
    result.issues.push({ sourceId: source.id, code: error instanceof IcalParseError ? "invalid_calendar" : "feed_unavailable" });
    return;
  }
  if (parsed.skippedEvents) result.issues.push({ sourceId: source.id, code: "invalid_calendar", skippedEvents: parsed.skippedEvents });
  const rows = parsed.rows;
  if (!rows.length) return;

  let persisted: { inserted: ImportedLumaEvent[]; available: ImportedLumaEvent[] };
  try {
    persisted = await repository.upsertEvents(rows);
    result.eventsInserted += persisted.inserted.length;
  } catch (error) {
    logger.error("Failed to persist imported events for source", { sourceId: source.id, count: rows.length }, error);
    result.issues.push({ sourceId: source.id, code: "database_error" });
    return;
  }

  await generateDraftsForPersistedEvents(source, persisted, generateDrafts, result);
}

export async function syncLumaSources(
  repository: SyncRepository,
  fetchFeed: FeedFetcher,
  generateDrafts?: DraftGenerator,
): Promise<SyncResult> {
  const sources = await repository.listEnabledLumaSources();
  const result: SyncResult = {
    sources: sources.length, feedsSucceeded: 0, feedsFailed: 0, eventsInserted: 0,
    draftsCreated: 0, draftEventsSkipped: 0, draftEventsFailed: 0, issues: [],
  };
  for (const source of sources) {
    await syncSingleSource(source, fetchFeed, repository, generateDrafts, result);
  }
  return result;
}

import { IcalParseError } from "./luma-ical";

const MAX_FEED_BYTES = 2_000_000;
const FEED_TIMEOUT_MS = 10_000;

async function readLimitedFeedBody(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_FEED_BYTES) throw new Error("Feed is too large");
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } catch (error) {
    try { await reader.cancel(error); } catch { /* Preserve the original read or size error. */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

const PRIVATE_HOST_PATTERN = /^(?:localhost|.*\.localhost|.*\.local|::1|127\..*|10\..*|192\.168\..*|169\.254\..*|172\.(?:1[6-9]|2\d|3[01])\..*)$/iu;

function normalizeSourceFeedUrl(parsed: URL): URL {
  const urlStr = parsed.toString();
  if (isSubstackUrl(urlStr) && /\/feed\/?$/iu.test(parsed.pathname)) {
    return new URL(normalizeSubstackPostsApiUrl(urlStr));
  }
  if (isMeetupUrl(urlStr)) {
    return new URL(normalizeMeetupRssUrl(urlStr));
  }
  return parsed;
}

function resolvePublicFeedUrl(url: string): URL {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Invalid feed URL"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Feed URL must use HTTPS");
  if (PRIVATE_HOST_PATTERN.test(parsed.hostname)) throw new Error("Private feed host is not allowed");
  return normalizeSourceFeedUrl(parsed);
}

export async function fetchLumaFeed(url: string): Promise<string> {
  const targetUrl = resolvePublicFeedUrl(url);
  const response = await fetch(targetUrl, {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    headers: { accept: "text/calendar, application/json, application/rss+xml, application/xml, text/xml, text/plain;q=0.9" },
  });
  if (!response.ok) throw new Error("Feed request failed");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_BYTES) {
    try { await response.body?.cancel(); } catch { /* Preserve the size rejection. */ }
    throw new Error("Feed is too large");
  }
  const rawBody = await readLimitedFeedBody(response);
  if (isMeetupUrl(url) && !/^BEGIN:VCALENDAR/iu.test(rawBody.trim())) {
    const items = parseMeetupRssFeed(rawBody, targetUrl.toString());
    const enriched = await enrichMeetupRssItems(items, targetUrl.toString());
    return JSON.stringify(enriched.filter((item) => Boolean(item.startsAt)));
  }
  return rawBody;
}
