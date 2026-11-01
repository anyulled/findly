export type SourceType = "luma_ical" | "meetup";

export type SourceInput = {
  name: string;
  type: SourceType;
  url: string;
  enabled?: boolean;
  accountIds: string[];
};

export function validateSource(input: SourceInput): SourceInput {
  if (!input || typeof input !== "object" || typeof input.name !== "string" || typeof input.url !== "string" || !Array.isArray(input.accountIds)) {
    throw new Error("Los datos de la fuente no son válidos.");
  }
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error("El nombre de la fuente debe tener entre 1 y 120 caracteres.");
  if (input.type !== "luma_ical" && input.type !== "meetup") throw new Error("El tipo de fuente no es válido.");
  let parsed: URL;
  try {
    parsed = new URL(input.url.trim());
  } catch {
    throw new Error("Introduce una URL válida para la fuente.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("La URL debe usar HTTP o HTTPS.");
  if (input.type === "meetup" && parsed.hostname !== "meetup.com" && !parsed.hostname.endsWith(".meetup.com")) {
    throw new Error("La URL de Meetup debe pertenecer a meetup.com.");
  }
  const accountIds = [...new Set(input.accountIds)];
  if (accountIds.length === 0 || accountIds.length > 20 || accountIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
    throw new Error("Asocia la fuente al menos con una cuenta válida.");
  }
  return { ...input, name, url: parsed.toString(), accountIds };
}
