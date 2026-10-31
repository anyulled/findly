import { detectTitleLanguage } from "./language";
import { parseLumaIcal, type LumaCalendarEvent } from "./luma-ical";

export type LumaSource = { id: string; ownerId: string; name: string; feedUrl: string };
export type PersistableEvent = {
  owner_id: string; source_id: string; external_id: string; title: string;
  starts_at: string; timezone: "Europe/Madrid"; location: string; description: string;
  event_url: string | null; detected_language: "en" | "es" | "ca";
};
export type SyncRepository = {
  listEnabledLumaSources(): Promise<LumaSource[]>;
  insertEvents(events: PersistableEvent[]): Promise<number>;
};
export type FeedFetcher = (url: string) => Promise<string>;

export type SyncResult = {
  sources: number; feedsSucceeded: number; feedsFailed: number; eventsInserted: number;
  issues: Array<{ sourceId: string; code: "feed_unavailable" | "invalid_calendar" | "database_error"; skippedEvents?: number }>;
};

export async function syncLumaSources(repository: SyncRepository, fetchFeed: FeedFetcher): Promise<SyncResult> {
  const sources = await repository.listEnabledLumaSources();
  const result: SyncResult = { sources: sources.length, feedsSucceeded: 0, feedsFailed: 0, eventsInserted: 0, issues: [] };
  for (const source of sources) {
    let parsed: ReturnType<typeof parseLumaIcal>;
    try {
      parsed = parseLumaIcal(await fetchFeed(source.feedUrl));
      result.feedsSucceeded += 1;
    } catch (error) {
      result.feedsFailed += 1;
      result.issues.push({ sourceId: source.id, code: error instanceof IcalParseError ? "invalid_calendar" : "feed_unavailable" });
      continue;
    }
    if (parsed.issues.length) result.issues.push({ sourceId: source.id, code: "invalid_calendar", skippedEvents: parsed.issues.length });
    const rows = parsed.events.map((event: LumaCalendarEvent): PersistableEvent => ({
      owner_id: source.ownerId, source_id: source.id, external_id: event.uid, title: event.title,
      starts_at: event.startsAt, timezone: "Europe/Madrid", location: event.location,
      description: event.description, event_url: event.url, detected_language: detectTitleLanguage(event.title),
    }));
    if (!rows.length) continue;
    try { result.eventsInserted += await repository.insertEvents(rows); }
    catch { result.issues.push({ sourceId: source.id, code: "database_error" }); }
  }
  return result;
}

import { IcalParseError } from "./luma-ical";

const MAX_FEED_BYTES = 2_000_000;
const FEED_TIMEOUT_MS = 10_000;

export async function fetchLumaFeed(url: string): Promise<string> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Invalid feed URL"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Feed URL must use HTTPS");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error("Private feed host is not allowed");
  const response = await fetch(parsed, {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    headers: { accept: "text/calendar, text/plain;q=0.9" },
  });
  if (!response.ok) throw new Error("Feed request failed");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_BYTES) throw new Error("Feed is too large");
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_FEED_BYTES) throw new Error("Feed is too large");
  return body;
}
