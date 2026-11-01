export type PostLanguage = "en" | "es" | "ca";

const TERMS: Record<PostLanguage, Set<string>> = {
  en: new Set(["the", "and", "for", "from", "with", "community", "meetup", "workshop", "night", "talk", "join", "event", "coffee", "builders", "product"]),
  es: new Set(["el", "los", "las", "del", "una", "para", "con", "comunidad", "reunión", "reunion", "evento", "taller", "charla", "próximo", "proximo", "noche", "conoce", "ven"]),
  ca: new Set(["els", "les", "dels", "amb", "comunitat", "trobada", "reunió", "reunio", "esdeveniment", "taller", "xerrada", "proper", "propera", "vine", "nit"]),
};

function checkDistinctiveCharacters(normalized: string): PostLanguage | null {
  if (normalized.includes("ç")) return "ca";
  if (/[ñ¿¡]/u.test(normalized)) return "es";
  return null;
}

function scoreLanguages(words: string[]): Record<PostLanguage, number> {
  const scores: Record<PostLanguage, number> = { en: 0, es: 0, ca: 0 };
  for (const word of words) {
    for (const language of Object.keys(TERMS) as PostLanguage[]) {
      if (TERMS[language].has(word)) scores[language] += 1;
    }
  }
  return scores;
}

export function detectTitleLanguage(title: string): PostLanguage {
  const normalized = title.toLowerCase();
  const distinctive = checkDistinctiveCharacters(normalized);
  if (distinctive) return distinctive;

  const words = normalized.match(/[a-zà-ÿ]+/gu) ?? [];
  const scores = scoreLanguages(words);
  const [candidate, score] = (Object.entries(scores) as [PostLanguage, number][]).sort((a, b) => b[1] - a[1])[0];
  if (score === 0) return "en";
  const runnerUp = Math.max(...Object.entries(scores).filter(([language]) => language !== candidate).map(([, value]) => value));
  return score > runnerUp ? candidate : "en";
}
