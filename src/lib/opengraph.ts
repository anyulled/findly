import { decodeHtmlEntities } from "./html-utils";

const PRIVATE_HOST_PATTERN = /^(?:localhost|0\.0\.0\.0|::|::1|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})$|(?:\.localhost|\.local|\.internal)$/iu;

const META_IMAGE_KEYS = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src", "image"];

function isPublicHttpsUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.port !== "" && url.port !== "443") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return Boolean(host) && !PRIVATE_HOST_PATTERN.test(host);
}

function toHttpsImageUrl(candidate: string | undefined | null, baseUrl?: string): string | null {
  const trimmed = candidate?.trim();
  if (!trimmed) return null;
  try {
    const resolved = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    return isPublicHttpsUrl(resolved) ? resolved.toString() : null;
  } catch {
    return null;
  }
}

function parseMetaAttributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu)) {
    result[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function extractMetaImage(html: string, baseUrl?: string): string | null {
  const metaMap: Record<string, string> = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/giu)) {
    const attrs = parseMetaAttributes(match[0]);
    const key = attrs.property ?? attrs.name ?? attrs.itemprop;
    if (key && attrs.content && !metaMap[key.toLowerCase()]) {
      metaMap[key.toLowerCase()] = attrs.content;
    }
  }
  for (const key of META_IMAGE_KEYS) {
    const resolved = toHttpsImageUrl(metaMap[key], baseUrl);
    if (resolved) return resolved;
  }
  return null;
}

function pickImageCandidate(imageField: unknown, baseUrl?: string): string | null {
  if (typeof imageField === "string") return toHttpsImageUrl(imageField, baseUrl);
  if (Array.isArray(imageField)) {
    for (const entry of imageField) {
      const resolved = pickImageCandidate(entry, baseUrl);
      if (resolved) return resolved;
    }
    return null;
  }
  if (imageField && typeof imageField === "object") {
    const obj = imageField as Record<string, unknown>;
    return toHttpsImageUrl(typeof obj.url === "string" ? obj.url : typeof obj.contentUrl === "string" ? obj.contentUrl : null, baseUrl);
  }
  return null;
}

function findImageInJsonNode(node: unknown, baseUrl?: string): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findImageInJsonNode(item, baseUrl);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  const direct = pickImageCandidate(record.image ?? record.thumbnailUrl, baseUrl);
  if (direct) return direct;
  if ("@graph" in record) return findImageInJsonNode(record["@graph"], baseUrl);
  return null;
}

function extractJsonLdImage(html: string, baseUrl?: string): string | null {
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    try {
      const found = findImageInJsonNode(JSON.parse(match[1]), baseUrl);
      if (found) return found;
    } catch { /* Ignore malformed JSON-LD blocks */ }
  }
  return null;
}

export function extractImageFromHtml(html: string, baseUrl?: string): string | null {
  return extractMetaImage(html, baseUrl) ?? extractJsonLdImage(html, baseUrl);
}

function resolveRedirectUrl(response: Response, current: URL): URL | null {
  if (![301, 302, 303, 307, 308].includes(response.status)) return null;
  const location = response.headers.get("location");
  if (!location) return null;
  try {
    const next = new URL(location, current);
    return isPublicHttpsUrl(next) ? next : null;
  } catch {
    return null;
  }
}

async function fetchHtmlBodyWithRedirects(
  initialUrl: URL,
  fetchImpl: typeof fetch,
): Promise<{ html: string; finalUrl: string } | null> {
  let current = initialUrl;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    try {
      const response = await fetchImpl(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(6_000),
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "user-agent": "Mozilla/5.0 (compatible; Findly/1.0; +https://findly.vercel.app)",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === 3) return null;
        const next = resolveRedirectUrl(response, current);
        if (!next) return null;
        current = next;
        continue;
      }
      if (!response.ok) return null;
      const html = (await response.text()).slice(0, 512_000);
      return { html, finalUrl: current.toString() };
    } catch {
      return null;
    }
  }
  return null;
}

export async function fetchOpenGraphImage(
  pageUrl: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!pageUrl) return null;
  let current: URL;
  try {
    current = new URL(pageUrl.trim());
  } catch {
    return null;
  }
  if (!isPublicHttpsUrl(current)) return null;

  const fetched = await fetchHtmlBodyWithRedirects(current, fetchImpl);
  return fetched ? extractImageFromHtml(fetched.html, fetched.finalUrl) : null;
}
