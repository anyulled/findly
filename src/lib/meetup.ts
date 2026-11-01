import { parseLumaIcal } from "./luma-ical";
import { madridDateTimeToIso } from "./madrid-time";
import { extractImageFromHtml } from "./opengraph";
import { extractXmlTag, decodeHtmlEntities as decodeEntities, unwrapCdata } from "./html-utils";

export type MeetupEventItem = {
  uid: string;
  title: string;
  description: string;
  url: string;
  startsAt: string | null;
  location: string;
  coverImage: string | null;
};

const LOCALE_SEGMENT = /^[a-z]{2}(?:-[a-z]{2})?$/iu;

const SPANISH_MONTHS: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", setiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

export function isMeetupUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase();
    return host === "meetup.com" || host.endsWith(".meetup.com");
  } catch {
    return false;
  }
}

export function extractMeetupGroupSlug(inputUrl: string): string | null {
  try {
    const parsed = new URL(inputUrl.trim());
    if (!isMeetupUrl(parsed.toString())) return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    const slug = LOCALE_SEGMENT.test(segments[0]) ? segments[1] : segments[0];
    return slug ? slug.trim() : null;
  } catch {
    return null;
  }
}

export function normalizeMeetupRssUrl(inputUrl: string): string {
  const slug = extractMeetupGroupSlug(inputUrl);
  if (!slug) return inputUrl.trim();
  return `https://www.meetup.com/${slug}/events/rss/`;
}

export function normalizeMeetupIcalUrl(inputUrl: string): string {
  const slug = extractMeetupGroupSlug(inputUrl);
  if (!slug) return inputUrl.trim();
  return `https://www.meetup.com/${slug}/events/ical/`;
}

export function cleanMeetupDescription(raw: string): string {
  const unwrapped = unwrapCdata(raw);
  const withoutTags = decodeEntities(unwrapped.replace(/<[^>]*>/gu, " "));
  const simplifiedLinks = withoutTags.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gu, (_m, label: string, url: string) =>
    label.trim() === url.trim() ? url.trim() : `${label.trim()} (${url.trim()})`,
  );
  return simplifiedLinks
    .replace(/[\u200b-\u200d\ufeff]/gu, "")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/\*([^*]+)\*/gu, "$1")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
    .slice(0, 1200);
}

function extractDateFromText(text: string): string | null {
  const esMatch = /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+|del?\s+)?(\d{4})/iu.exec(text);
  if (esMatch) {
    const day = esMatch[1].padStart(2, "0");
    const month = SPANISH_MONTHS[esMatch[2].toLowerCase()];
    return `${esMatch[3]}-${month}-${day}`;
  }
  const isoMatch = /\b(20\d{2}-\d{2}-\d{2})\b/u.exec(text);
  return isoMatch ? isoMatch[1] : null;
}

function extractTimeFromText(text: string): string | null {
  const match = /\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:h\b|hrs?\b|horas?\b|CET\b|CEST\b)/iu.exec(text);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function extractLocationFromText(text: string): string {
  const matches = [
    ...Array.from(text.matchAll(/🏢\s*([^\n📍📅]+)/gu), (m) => m[1]),
    ...Array.from(text.matchAll(/📍\s*([^\n🏢📅]+)/gu), (m) => m[1]),
  ];
  const parts = matches
    .map((part) => part.replace(/\*+/gu, "").trim().replace(/\.$/u, ""))
    .filter((part) => Boolean(part && !part.includes("¿") && !part.includes("?")));
  return parts.length > 0 ? parts.join(", ") : "Barcelona";
}

function resolveRssUid(guid: string, link: string): string {
  const idMatch = /\/events\/([^/?#]+)/iu.exec(guid || link);
  return idMatch?.[1] ? `event_${idMatch[1]}@meetup.com` : (guid || link);
}

function resolveFallbackStartsAt(rawDescription: string): string | null {
  const dateInText = extractDateFromText(rawDescription);
  const timeInText = extractTimeFromText(rawDescription) ?? "18:30";
  if (dateInText) {
    try {
      return madridDateTimeToIso(dateInText, timeInText);
    } catch { /* Ignore invalid date in description */ }
  }
  return null;
}

export function parseMeetupRssFeed(rawXml: string, baseUrl: string): MeetupEventItem[] {
  const origin = new URL(baseUrl).origin;
  const items: MeetupEventItem[] = [];
  for (const match of rawXml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)) {
    const block = match[1];
    const title = cleanMeetupDescription(extractXmlTag(block, "title"));
    if (!title) continue;
    const rawDescription = extractXmlTag(block, "description");
    const link = decodeEntities(extractXmlTag(block, "link")) || origin;
    const guid = decodeEntities(extractXmlTag(block, "guid")) || link;
    items.push({
      uid: resolveRssUid(guid, link),
      title,
      description: cleanMeetupDescription(rawDescription),
      url: link,
      startsAt: resolveFallbackStartsAt(rawDescription),
      location: extractLocationFromText(rawDescription),
      coverImage: null,
    });
  }
  return items;
}

function extractLdJsonLocation(locValue: unknown): string | undefined {
  if (!locValue || typeof locValue !== "object") return undefined;
  const locObj = locValue as Record<string, unknown>;
  const addrObj = locObj.address && typeof locObj.address === "object" ? locObj.address as Record<string, unknown> : null;
  const locParts = [locObj.name, addrObj?.addressLocality]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => part.trim());
  return locParts.length > 0 ? [...new Set(locParts)].join(", ") : undefined;
}

function extractLdJsonImage(imageValue: unknown): string | undefined {
  const images = Array.isArray(imageValue) ? imageValue : typeof imageValue === "string" ? [imageValue] : [];
  return images.find((img): img is string => typeof img === "string" && /^https:\/\//iu.test(img.trim()));
}

function parseEventDetailsFromJsonLdNode(
  obj: Record<string, unknown>,
  fallbackImage?: string,
): { startsAt?: string; location?: string; coverImage?: string } | null {
  if (obj["@type"] !== "Event") return null;
  const startRaw = typeof obj.startDate === "string" ? new Date(obj.startDate) : null;
  const startsAt = startRaw && Number.isFinite(startRaw.getTime()) ? startRaw.toISOString() : undefined;
  return {
    startsAt,
    location: extractLdJsonLocation(obj.location),
    coverImage: extractLdJsonImage(obj.image) ?? fallbackImage,
  };
}

function parseEventPageLdJson(html: string, pageUrl?: string): { startsAt?: string; location?: string; coverImage?: string } {
  const fallbackImage = extractImageFromHtml(html, pageUrl) ?? undefined;
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    try {
      const parsed: unknown = JSON.parse(match[1]);
      const record = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!record || typeof record !== "object") continue;
      const details = parseEventDetailsFromJsonLdNode(record as Record<string, unknown>, fallbackImage);
      if (details) return details;
    } catch { /* Continue checking other scripts */ }
  }
  return { coverImage: fallbackImage };
}

export async function enrichMeetupRssItems(
  items: MeetupEventItem[],
  feedUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MeetupEventItem[]> {
  if (items.length === 0) return [];
  const icalByUid = new Map<string, { startsAt: string; location: string }>();
  try {
    const icalRes = await fetchImpl(normalizeMeetupIcalUrl(feedUrl), {
      headers: { accept: "text/calendar, text/plain;q=0.9" },
      signal: AbortSignal.timeout(8_000),
    });
    if (icalRes.ok) {
      const parsedIcal = parseLumaIcal(await icalRes.text());
      for (const ev of parsedIcal.events) {
        icalByUid.set(ev.uid, { startsAt: ev.startsAt, location: ev.location });
      }
    }
  } catch { /* Optional iCal enrichment */ }

  return Promise.all(items.slice(0, 10).map(async (item) => {
    const ical = icalByUid.get(item.uid);
    let pageMeta: { startsAt?: string; location?: string; coverImage?: string } = {};
    if (/^https:\/\/(?:www\.)?meetup\.com\//iu.test(item.url)) {
      try {
        const pageRes = await fetchImpl(item.url, {
          headers: { accept: "text/html,application/xhtml+xml" },
          signal: AbortSignal.timeout(8_000),
        });
        if (pageRes.ok) pageMeta = parseEventPageLdJson(await pageRes.text(), item.url);
      } catch { /* Optional page enrichment */ }
    }
    return {
      ...item,
      startsAt: pageMeta.startsAt ?? ical?.startsAt ?? item.startsAt,
      location: pageMeta.location || ical?.location || item.location,
      coverImage: pageMeta.coverImage ?? item.coverImage,
    };
  }));
}

export function parseMeetupFeed(content: string, feedUrl: string): MeetupEventItem[] {
  const trimmed = content.trim();
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is MeetupEventItem =>
      Boolean(item && typeof item === "object" && typeof (item as MeetupEventItem).title === "string" && (item as MeetupEventItem).title),
    );
  }
  if (/^BEGIN:VCALENDAR/iu.test(trimmed)) {
    const cal = parseLumaIcal(trimmed);
    return cal.events.map((ev) => ({
      uid: ev.uid,
      title: ev.title,
      description: cleanMeetupDescription(ev.description),
      url: ev.url ?? feedUrl,
      startsAt: ev.startsAt,
      location: ev.location || "Barcelona",
      coverImage: null,
    }));
  }
  return parseMeetupRssFeed(trimmed, feedUrl);
}
