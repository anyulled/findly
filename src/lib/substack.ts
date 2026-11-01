export type SubstackPostItem = {
  uid: string;
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  coverImage: string | null;
};

export function isSubstackUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase();
    return host === "substack.com" || host.endsWith(".substack.com") || parsed.pathname.endsWith("/api/v1/posts");
  } catch {
    return false;
  }
}

export function normalizeSubstackPostsApiUrl(inputUrl: string): string {
  const parsed = new URL(inputUrl.trim());
  return `${parsed.origin}/api/v1/posts`;
}

export function packLocationAndImage(place: string, imageUrl?: string | null): string {
  const cleanPlace = place.trim();
  const cleanImage = imageUrl?.trim() ?? "";
  if (!cleanImage) return cleanPlace;
  return cleanPlace ? `${cleanPlace}\n${cleanImage}` : cleanImage;
}

export function unpackLocationAndImage(rawLocation: string): { place: string; imageUrl?: string } {
  const trimmed = rawLocation.trim();
  if (!trimmed) return { place: "" };
  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  if (/^https:\/\//iu.test(last)) {
    const place = lines.slice(0, -1).join(", ");
    return { place, imageUrl: last };
  }
  return { place: trimmed };
}

function decodeEntities(value: string): string {
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

function stripTagsAndClean(value: unknown): string {
  if (typeof value !== "string") return "";
  const withoutCdata = value.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/u, "$1");
  return decodeEntities(withoutCdata.replace(/<[^>]*>/gu, " ")).replace(/[\s\u00a0]+/gu, " ").trim();
}

function resolvePostDescription(record: Record<string, unknown>): string {
  for (const key of ["description", "subtitle", "search_engine_description", "body_html"]) {
    const cleaned = stripTagsAndClean(record[key]);
    if (cleaned) return cleaned.slice(0, 600);
  }
  return "";
}

function resolvePostImage(record: Record<string, unknown>): string | null {
  for (const key of ["cover_image", "podcast_episode_image_url", "podcast_art_url"]) {
    const val = record[key];
    if (typeof val === "string" && /^https:\/\//iu.test(val.trim())) return val.trim();
  }
  return null;
}

function resolvePostUrl(record: Record<string, unknown>, origin: string): string {
  if (typeof record.canonical_url === "string" && /^https:\/\//iu.test(record.canonical_url.trim())) {
    return record.canonical_url.trim();
  }
  if (typeof record.slug === "string" && record.slug.trim()) {
    return `${origin}/p/${record.slug.trim()}`;
  }
  return origin;
}

function resolvePublishedAt(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value.trim());
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function toSubstackItem(entry: unknown, origin: string): SubstackPostItem | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const title = stripTagsAndClean(record.title);
  if (!title) return null;
  const url = resolvePostUrl(record, origin);
  const uid = String(record.id ?? record.slug ?? url);
  return {
    uid,
    title,
    description: resolvePostDescription(record),
    url,
    publishedAt: resolvePublishedAt(record.post_date),
    coverImage: resolvePostImage(record),
  };
}

export function parseSubstackPostsJson(rawJson: string, baseUrl: string): SubstackPostItem[] {
  const origin = new URL(baseUrl).origin;
  const parsed: unknown = JSON.parse(rawJson);
  const rawList = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { posts?: unknown }).posts)
      ? (parsed as { posts: unknown[] }).posts
      : [];
  return rawList.flatMap((entry) => {
    const item = toSubstackItem(entry, origin);
    return item ? [item] : [];
  });
}

function extractXmlTag(block: string, tag: string): string {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "iu").exec(block);
  if (!match) return "";
  return match[1].trim().replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/u, "$1").trim();
}

function extractRssCoverImage(itemXml: string, channelImage: string | null): string | null {
  const itunesMatch = /<itunes:image\b[^>]*href\s*=\s*["']([^"']+)["']/iu.exec(itemXml);
  if (itunesMatch?.[1] && /^https:\/\//iu.test(itunesMatch[1])) return decodeEntities(itunesMatch[1]);
  const enclosureMatch = /<enclosure\b[^>]*url\s*=\s*["']([^"']+)["'][^>]*type\s*=\s*["']image\/[^"']*["']/iu.exec(itemXml);
  if (enclosureMatch?.[1] && /^https:\/\//iu.test(enclosureMatch[1])) return decodeEntities(enclosureMatch[1]);
  const imgMatch = /<img\b[^>]*src\s*=\s*["'](https:\/\/[^"']+)["']/iu.exec(itemXml);
  if (imgMatch?.[1]) return decodeEntities(imgMatch[1]);
  return channelImage;
}

export function parseSubstackRssFeed(rawXml: string, baseUrl: string): SubstackPostItem[] {
  const origin = new URL(baseUrl).origin;
  const channelImgBlock = /<image>([\s\S]*?)<\/image>/iu.exec(rawXml)?.[1] ?? "";
  const channelImgUrl = extractXmlTag(channelImgBlock, "url");
  const fallbackImage = /^https:\/\//iu.test(channelImgUrl) ? decodeEntities(channelImgUrl) : null;
  const items: SubstackPostItem[] = [];
  for (const match of rawXml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)) {
    const block = match[1];
    const title = stripTagsAndClean(extractXmlTag(block, "title"));
    if (!title) continue;
    const rawDesc = extractXmlTag(block, "description") || extractXmlTag(block, "content:encoded");
    const description = stripTagsAndClean(rawDesc).slice(0, 600);
    const link = decodeEntities(extractXmlTag(block, "link")) || origin;
    const guid = decodeEntities(extractXmlTag(block, "guid")) || link;
    const pubDate = resolvePublishedAt(extractXmlTag(block, "pubDate"));
    const coverImage = extractRssCoverImage(block, fallbackImage);
    items.push({ uid: guid, title, description, url: link, publishedAt: pubDate, coverImage });
  }
  return items;
}

export function parseSubstackFeed(content: string, feedUrl: string): SubstackPostItem[] {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseSubstackPostsJson(trimmed, feedUrl);
  }
  return parseSubstackRssFeed(trimmed, feedUrl);
}
