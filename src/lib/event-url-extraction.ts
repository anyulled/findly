import { formatMadridDateTime } from "@/lib/madrid-time";
import { isSubstackUrl, normalizeSubstackPostsApiUrl, parseSubstackFeed } from "@/lib/substack";
import { enrichMeetupRssItems, isMeetupUrl, parseMeetupRssFeed } from "@/lib/meetup";

const MAX_HTML_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

const MONTH_NAMES: Record<string, string> = {
  jan: "01", ene: "01", feb: "02", mar: "03", apr: "04", abr: "04",
  may: "05", jun: "06", jul: "07", aug: "08", ago: "08",
  sep: "09", set: "09", oct: "10", nov: "11", dec: "12", dic: "12",
};

const PRIVATE_HOST_PATTERN = /^(?:localhost|0\.0\.0\.0|::|::1|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})$|(?:\.localhost|\.local|\.internal)$/iu;

export type EventPageDetails = {
  title: string;
  date: string;
  time: string;
  place: string;
  description: string;
  url: string;
  imageUrl?: string;
};

export type EventPageExtraction = {
  event: EventPageDetails;
  missingFields: Array<"date" | "time" | "place" | "description">;
};

export class EventUrlExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventUrlExtractionError";
  }
}

function isPrivateHost(host: string): boolean {
  return PRIVATE_HOST_PATTERN.test(host.toLowerCase().replace(/^\[|\]$/gu, ""));
}

function isSupportedUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port !== "" && url.port !== "443") return false;
  return Boolean(url.hostname) && !isPrivateHost(url.hostname);
}

function decodeHtml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|#39|lt|gt|nbsp);/giu, (entity, code: string) => {
    const normalized = code.toLowerCase();
    if (normalized.startsWith("#x")) {
      const point = Number.parseInt(normalized.slice(2), 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : "";
    }
    if (normalized.startsWith("#")) {
      const point = Number.parseInt(normalized.slice(1), 10);
      return point <= 0x10ffff ? String.fromCodePoint(point) : "";
    }
    return ({ amp: "&", quot: '"', apos: "'", "#39": "'", lt: "<", gt: ">", nbsp: " " } as Record<string, string>)[normalized] ?? entity;
  });
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return decodeHtml(value.replace(/<[^>]*>/gu, " ")).replace(/[\s\u00a0]+/gu, " ").trim();
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu)) {
    result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function readMeta(html: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/giu)) {
    const attrs = attributes(match[0]);
    const key = attrs.property ?? attrs.name ?? attrs.itemprop;
    if (key && attrs.content) values[key.toLowerCase()] = attrs.content;
  }
  return values;
}

function eventRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(eventRecords);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  const isEvent = (Array.isArray(type) ? type : [type]).some((entry) => typeof entry === "string" && /event/iu.test(entry));
  return [ ...(isEvent ? [record] : []), ...("@graph" in record ? eventRecords(record["@graph"]) : []) ];
}

function structuredEvents(html: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
    if (!/type\s*=\s*["']application\/ld\+json["']/iu.test(match[1])) continue;
    try { records.push(...eventRecords(JSON.parse(match[2]))); }
    catch { /* Ignore malformed structured data and use available page metadata. */ }
  }
  return records;
}

function locationText(value: unknown): string {
  const location = Array.isArray(value) ? value[0] : value;
  if (typeof location === "string") return cleanText(location);
  if (!location || typeof location !== "object") return "";
  const record = location as Record<string, unknown>;
  const address = record.address;
  const addressParts = typeof address === "string" ? [address] : address && typeof address === "object"
    ? ["streetAddress", "addressLocality", "addressRegion", "postalCode"].map((key) => (address as Record<string, unknown>)[key])
    : [];
  return [...new Set([cleanText(record.name), ...addressParts.map(cleanText)].filter(Boolean))].join(", ");
}

function parseTextDate(text: string): string {
  const iso = /\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/u.exec(text);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  const numeric = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/u.exec(text);
  if (numeric) return `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;

  const alpha = /\b(\d{1,2})[/\s-]([a-z]{3,4})[/\s-](\d{4})\b/iu.exec(text);
  if (alpha) {
    const month = MONTH_NAMES[alpha[2].toLowerCase().slice(0, 3)];
    if (month) return `${alpha[3]}-${month}-${alpha[1].padStart(2, "0")}`;
  }
  return "";
}

function parseTextTime(text: string): string {
  const match = /\b([01]?\d|2[0-3]):([0-5]\d)\b/u.exec(text);
  if (match) return `${match[1].padStart(2, "0")}:${match[2]}`;
  return "";
}

function eventDateTime(value: unknown): { date: string; time: string } {
  if (typeof value !== "string" || !value.trim()) return { date: "", time: "" };
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return { date: raw, time: "" };
  const floatingDateTime = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/u.exec(raw);
  if (floatingDateTime) return { date: floatingDateTime[1], time: `${floatingDateTime[2]}:${floatingDateTime[3]}` };
  const instant = new Date(raw);
  if (!Number.isFinite(instant.getTime())) return { date: "", time: "" };
  return formatMadridDateTime(instant);
}

function extractFallbackDateTime(html: string): { date: string; time: string } {
  for (const match of html.matchAll(/<time\b[^>]*datetime\s*=\s*["']([^"']+)["'][^>]*>/giu)) {
    const dt = eventDateTime(match[1]);
    if (dt.date) return dt;
  }
  let date = "";
  let time = "";
  for (const match of html.matchAll(/class\s*=\s*["'][^"']*(?:event-date|date|agenda)[^"']*["'][^>]*>([\s\S]*?)<\//giu)) {
    const text = cleanText(match[1]);
    const d = parseTextDate(text);
    if (d) { date = d; break; }
  }
  for (const match of html.matchAll(/class\s*=\s*["'][^"']*(?:time|hour|hora|schedule)[^"']*["'][^>]*>([\s\S]*?)<\//giu)) {
    const text = cleanText(match[1]);
    const t = parseTextTime(text);
    if (t) { time = t; break; }
  }
  return { date, time: time || parseTextTime(html) };
}

function extractFallbackPlace(html: string): string {
  for (const match of html.matchAll(/<div\b[^>]*class\s*=\s*["'][^"']*(?:location|venue|place)[^"']*["'][^>]*>([\s\S]*?)<\/div>/giu)) {
    const loc = cleanText(match[1]);
    if (loc && loc.length > 2 && loc.length < 150) return loc;
  }
  return "";
}

function resolveTitle(structured: Record<string, unknown> | undefined, meta: Record<string, string>, html: string): string {
  const structuredName = cleanText(structured?.name);
  if (structuredName) return structuredName;
  const metaTitle = cleanText(meta["og:title"] || meta["twitter:title"]);
  if (metaTitle) return metaTitle;
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu.exec(html)?.[1];
  return cleanText(titleTag ?? "");
}

function resolveDateTime(structured: Record<string, unknown> | undefined, meta: Record<string, string>, html: string): { date: string; time: string } {
  const explicit = eventDateTime(structured?.startDate ?? structured?.start_date ?? meta["event:start_time"] ?? meta["og:start_time"]);
  if (explicit.date) return explicit;
  const fallback = extractFallbackDateTime(html);
  return { date: fallback.date, time: explicit.time || fallback.time };
}

function resolvePlace(structured: Record<string, unknown> | undefined, meta: Record<string, string>, html: string): string {
  const structuredLoc = locationText(structured?.location);
  if (structuredLoc) return structuredLoc;
  const metaLoc = cleanText(meta["event:location"] || meta["og:locality"]);
  if (metaLoc) return metaLoc;
  return extractFallbackPlace(html);
}

function resolveDescription(structured: Record<string, unknown> | undefined, meta: Record<string, string>): string {
  const structuredDesc = cleanText(structured?.description);
  if (structuredDesc) return structuredDesc;
  return cleanText(meta["og:description"] || meta.description || meta["twitter:description"]);
}

function resolveImage(meta: Record<string, string>): string | undefined {
  const candidate = (meta["og:image"] || meta["twitter:image"] || "").trim();
  return /^https:\/\//iu.test(candidate) ? candidate : undefined;
}

export function parseEventPage(html: string, pageUrl: string): EventPageExtraction {
  const meta = readMeta(html);
  const structured = structuredEvents(html)[0];
  const title = resolveTitle(structured, meta, html);
  if (!title) throw new EventUrlExtractionError("No pude encontrar el título del evento en esa página.");

  const dateTime = resolveDateTime(structured, meta, html);
  const place = resolvePlace(structured, meta, html);
  const description = resolveDescription(structured, meta);
  const imageUrl = resolveImage(meta);
  const url = new URL(pageUrl);
  const event: EventPageDetails = {
    title,
    ...dateTime,
    place,
    description,
    url: url.toString(),
    ...(imageUrl ? { imageUrl } : {}),
  };

  const requiredFields = isSubstackUrl(url.toString())
    ? (["description"] as const)
    : (["date", "time", "place", "description"] as const);
  const missingFields = requiredFields.filter((field) => !event[field]);
  return { event, missingFields };
}

function parseSubstackFeedExtraction(body: string, pageUrl: string): EventPageExtraction {
  let items: ReturnType<typeof parseSubstackFeed>;
  try {
    items = parseSubstackFeed(body, pageUrl);
  } catch {
    throw new EventUrlExtractionError("No se pudieron leer las publicaciones de Substack.");
  }
  const latest = items[0];
  if (!latest) throw new EventUrlExtractionError("No se encontraron publicaciones en ese feed de Substack.");
  const event: EventPageDetails = {
    title: latest.title,
    date: "",
    time: "",
    place: "",
    description: latest.description,
    url: latest.url,
    ...(latest.coverImage ? { imageUrl: latest.coverImage } : {}),
  };
  return {
    event,
    missingFields: event.description ? [] : ["description"],
  };
}

async function enrichSubstackCoverFromApi(extraction: EventPageExtraction, feedUrl: string, fetchImpl: typeof fetch): Promise<EventPageExtraction> {
  if (extraction.event.imageUrl) return extraction;
  try {
    const apiUrl = normalizeSubstackPostsApiUrl(feedUrl);
    const response = await fetchImpl(apiUrl, {
      signal: AbortSignal.timeout(6_000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return extraction;
    const items = parseSubstackFeed(await readHtml(response), apiUrl);
    const matching = items.find((item) => item.url === extraction.event.url || item.title === extraction.event.title) ?? items[0];
    if (matching?.coverImage) {
      return { ...extraction, event: { ...extraction.event, imageUrl: matching.coverImage } };
    }
  } catch { /* Preserve RSS extraction if cover API enrichment is unavailable. */ }
  return extraction;
}

async function readHtml(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_HTML_BYTES) throw new EventUrlExtractionError("La página del evento es demasiado grande para extraerla.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new EventUrlExtractionError("La página del evento es demasiado grande para extraerla.");
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

async function parseMeetupFeedExtraction(rawContent: string, feedUrl: string, fetchImpl: typeof fetch): Promise<EventPageExtraction> {
  const items = await enrichMeetupRssItems(parseMeetupRssFeed(rawContent, feedUrl), feedUrl, fetchImpl);
  const latest = items[0];
  if (!latest) throw new EventUrlExtractionError("No se encontraron eventos activos en ese feed de Meetup.");
  const scheduled = formatMadridDateTime(latest.startsAt);
  const event: EventPageDetails = {
    title: latest.title,
    date: scheduled.date,
    time: scheduled.time,
    place: latest.location,
    description: latest.description,
    url: latest.url,
    ...(latest.coverImage ? { imageUrl: latest.coverImage } : {}),
  };
  return {
    event,
    missingFields: (["date", "time", "place", "description"] as const).filter((field) => !event[field]),
  };
}

async function parseFetchedResponse(response: Response, current: URL, fetchImpl: typeof fetch): Promise<EventPageExtraction> {
  const urlString = current.toString();
  const contentType = response.headers.get("content-type") ?? "";
  if (isSubstackUrl(urlString) && (/json|xml|rss/iu.test(contentType) || /\/(?:feed|api\/v1\/posts)\b/iu.test(current.pathname))) {
    const extracted = parseSubstackFeedExtraction(await readHtml(response), urlString);
    return enrichSubstackCoverFromApi(extracted, urlString, fetchImpl);
  }
  if (isMeetupUrl(urlString) && (/xml|rss/iu.test(contentType) || /\/events\/rss\/?$/iu.test(current.pathname))) {
    return parseMeetupFeedExtraction(await readHtml(response), urlString, fetchImpl);
  }
  if (!/text\/html|application\/xhtml\+xml/iu.test(contentType)) {
    throw new EventUrlExtractionError("La URL no devolvió una página HTML de evento.");
  }
  return parseEventPage(await readHtml(response), urlString);
}

export async function extractEventPageDetails(input: string, fetchImpl: typeof fetch = fetch): Promise<EventPageExtraction> {
  if (typeof input !== "string" || input.length > 2_048) throw new EventUrlExtractionError("El enlace del evento debe tener menos de 2048 caracteres.");
  let current: URL;
  try { current = new URL(input.trim()); }
  catch { throw new EventUrlExtractionError("Introduce una URL HTTPS válida."); }
  if (!isSupportedUrl(current)) throw new EventUrlExtractionError("La extracción solo admite enlaces web públicos HTTPS.");

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response: Response;
    try {
      response = await fetchImpl(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
        headers: { accept: "text/html,application/xhtml+xml,application/json,application/rss+xml,application/xml,text/xml;q=0.9", "user-agent": "Mozilla/5.0 (compatible; Findly/1.0; +https://findly.vercel.app)" },
      });
    } catch {
      throw new EventUrlExtractionError("No se pudo leer la página del evento. Comprueba el enlace e inténtalo de nuevo.");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) throw new EventUrlExtractionError("La página redirigió demasiadas veces.");
      current = new URL(location, current);
      if (!isSupportedUrl(current)) throw new EventUrlExtractionError("La página redirige a un dominio o protocolo no admitido.");
      continue;
    }
    if (!response.ok) throw new EventUrlExtractionError("El proveedor no pudo cargar esa página del evento.");
    return parseFetchedResponse(response, current, fetchImpl);
  }
  throw new EventUrlExtractionError("La página redirigió demasiadas veces.");
}
