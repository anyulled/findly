export function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|quot|apos|#39|lt|gt|nbsp);/giu,
    (entity, code: string) => {
      const normalized = code.toLowerCase();
      if (normalized.startsWith("#x")) {
        const point = Number.parseInt(normalized.slice(2), 16);
        return point <= 0x10ffff ? String.fromCodePoint(point) : "";
      }
      if (normalized.startsWith("#")) {
        const point = Number.parseInt(normalized.slice(1), 10);
        return point <= 0x10ffff ? String.fromCodePoint(point) : "";
      }
      return (
        ({
          amp: "&",
          quot: '"',
          apos: "'",
          "#39": "'",
          lt: "<",
          gt: ">",
          nbsp: " ",
        } as Record<string, string>)[normalized] ?? entity
      );
    },
  );
}

export function unwrapCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/u, "$1");
}

export function stripTagsAndClean(value: unknown): string {
  if (typeof value !== "string") return "";
  const unwrapped = unwrapCdata(value);
  return decodeHtmlEntities(unwrapped.replace(/<[^>]*>/gu, " "))
    .replace(/[\s\u00a0]+/gu, " ")
    .trim();
}

export function extractXmlTag(block: string, tag: string): string {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "iu").exec(block);
  if (!match) return "";
  return unwrapCdata(match[1].trim()).trim();
}
