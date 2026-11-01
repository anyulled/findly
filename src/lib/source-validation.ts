export type SourceType = "luma_ical" | "meetup" | "substack";

export type SourceInput = {
  name: string;
  type: SourceType;
  url: string;
  enabled?: boolean;
  accountIds: string[];
};

const VALID_SOURCE_TYPES = new Set<SourceType>(["luma_ical", "meetup", "substack"]);

function parseSourceUrl(rawUrl: string, type: SourceType): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Introduce una URL válida para la fuente.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("La URL debe usar HTTP o HTTPS.");
  if (type === "meetup" && parsed.hostname !== "meetup.com" && !parsed.hostname.endsWith(".meetup.com")) {
    throw new Error("La URL de Meetup debe pertenecer a meetup.com.");
  }
  return parsed.toString();
}

function validateSourceStructure(input: unknown): asserts input is SourceInput {
  if (!input || typeof input !== "object") throw new Error("Los datos de la fuente no son válidos.");
  const cand = input as Partial<SourceInput>;
  if (typeof cand.name !== "string" || typeof cand.url !== "string" || !Array.isArray(cand.accountIds)) {
    throw new Error("Los datos de la fuente no son válidos.");
  }
}

function validateSourceAccounts(accountIds: string[]): string[] {
  const unique = [...new Set(accountIds)];
  const isInvalid = unique.length === 0 || unique.length > 20 || unique.some((id) => !/^[0-9a-f-]{36}$/i.test(id));
  if (isInvalid) throw new Error("Asocia la fuente al menos con una cuenta válida.");
  return unique;
}

export function validateSource(input: SourceInput): SourceInput {
  validateSourceStructure(input);
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error("El nombre de la fuente debe tener entre 1 y 120 caracteres.");
  if (!VALID_SOURCE_TYPES.has(input.type)) throw new Error("El tipo de fuente no es válido.");
  const url = parseSourceUrl(input.url, input.type);
  const accountIds = validateSourceAccounts(input.accountIds);
  return { ...input, name, url, accountIds };
}
