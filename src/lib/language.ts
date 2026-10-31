export type PostLanguage = "en" | "es" | "ca";

const TERMS: Record<PostLanguage, Set<string>> = {
  en: new Set(["the", "and", "for", "from", "with", "community", "meetup", "workshop", "night", "talk", "join", "event", "coffee", "builders", "product"]),
  es: new Set(["el", "los", "las", "del", "una", "para", "con", "comunidad", "reunión", "reunion", "evento", "taller", "charla", "próximo", "proximo", "noche", "conoce", "ven"]),
  ca: new Set(["els", "les", "dels", "amb", "comunitat", "trobada", "reunió", "reunio", "esdeveniment", "taller", "xerrada", "proper", "propera", "vine", "nit"]),
};

export function detectTitleLanguage(title: string): PostLanguage {
  const normalized = title.toLowerCase();
  if (normalized.includes("ç")) return "ca";
  if (normalized.includes("ñ") || normalized.includes("¿") || normalized.includes("¡")) return "es";
  const words = normalized.match(/[a-zà-ÿ]+/gu) ?? [];
  const scores: Record<PostLanguage, number> = { en: 0, es: 0, ca: 0 };
  for (const word of words) {
    for (const language of Object.keys(TERMS) as PostLanguage[]) {
      if (TERMS[language].has(word)) scores[language] += 1;
    }
  }
  const [candidate, score] = (Object.entries(scores) as [PostLanguage, number][]).sort((a, b) => b[1] - a[1])[0];
  if (score === 0) return "en";
  const runnerUp = Math.max(...Object.entries(scores).filter(([language]) => language !== candidate).map(([, value]) => value));
  return score > runnerUp ? candidate : "en";
}
