import { formatMadridDateTime } from "@/lib/madrid-time";

const MAX_HTML_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const SUPPORTED_HOSTS = ["lu.ma", "luma.com", "meetup.com"];

export type EventPageDetails = {
  title: string;
  date: string;
  time: string;
  place: string;
  description: string;
  url: string;
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

function isSupportedUrl(url: URL): boolean {
  return url.protocol === "https:" && !url.username && !url.password &&
    (url.port === "" || url.port === "443") &&
    SUPPORTED_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
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

function eventDateTime(value: unknown): { date: string; time: string } {
  if (typeof value !== "string" || !value.trim()) return { date: "", time: "" };
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return { date: raw, time: "" };
  const instant = new Date(raw);
  if (!Number.isFinite(instant.getTime())) return { date: "", time: "" };
  return formatMadridDateTime(instant);
}

export function parseEventPage(html: string, pageUrl: string): EventPageExtraction {
  const meta = readMeta(html);
  const structured = structuredEvents(html)[0];
  const title = cleanText(structured?.name) || cleanText(meta["og:title"] || meta["twitter:title"]) ||
    cleanText(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu.exec(html)?.[1] ?? "");
  if (!title) throw new EventUrlExtractionError("No pude encontrar el título del evento en esa página.");

  const dateTime = eventDateTime(structured?.startDate ?? structured?.start_date ?? meta["event:start_time"] ?? meta["og:start_time"]);
  const place = locationText(structured?.location) || cleanText(meta["event:location"] || meta["og:locality"]);
  const description = cleanText(structured?.description) || cleanText(meta["og:description"] || meta.description || meta["twitter:description"]);
  const url = new URL(pageUrl);
  const event: EventPageDetails = { title, ...dateTime, place, description, url: url.toString() };
  const missingFields: EventPageExtraction["missingFields"] = [];
  if (!event.date) missingFields.push("date");
  if (!event.time) missingFields.push("time");
  if (!event.place) missingFields.push("place");
  if (!event.description) missingFields.push("description");
  return { event, missingFields };
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

export async function extractEventPageDetails(input: string, fetchImpl: typeof fetch = fetch): Promise<EventPageExtraction> {
  if (typeof input !== "string" || input.length > 2_048) throw new EventUrlExtractionError("El enlace del evento debe tener menos de 2048 caracteres.");
  let current: URL;
  try { current = new URL(input.trim()); }
  catch { throw new EventUrlExtractionError("Introduce una URL válida de Meetup o Luma."); }
  if (!isSupportedUrl(current)) throw new EventUrlExtractionError("La extracción solo admite enlaces HTTPS de Meetup o Luma.");

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response: Response;
    try {
      response = await fetchImpl(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
        headers: { accept: "text/html,application/xhtml+xml" },
      });
    } catch {
      throw new EventUrlExtractionError("No se pudo leer la página del evento. Comprueba el enlace e inténtalo de nuevo.");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) throw new EventUrlExtractionError("La página redirigió demasiadas veces.");
      current = new URL(location, current);
      if (!isSupportedUrl(current)) throw new EventUrlExtractionError("La página redirige a un dominio no admitido.");
      continue;
    }
    if (!response.ok) throw new EventUrlExtractionError("El proveedor no pudo cargar esa página del evento.");
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/iu.test(contentType)) throw new EventUrlExtractionError("La URL no devolvió una página HTML de evento.");
    return parseEventPage(await readHtml(response), current.toString());
  }
  throw new EventUrlExtractionError("La página redirigió demasiadas veces.");
}
