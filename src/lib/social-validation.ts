export type SocialNetwork = "LinkedIn" | "X" | "Bluesky";

export const NETWORKS: readonly SocialNetwork[] = ["LinkedIn", "X", "Bluesky"] as const;

const LIMITS: Record<SocialNetwork, number> = {
  LinkedIn: 3000,
  X: 280,
  Bluesky: 300,
};

function countXCharacters(text: string): number {
  const withoutUrls = text.replace(/https?:\/\/[^\s]+/gu, "");
  const weightedText = [...withoutUrls].reduce((total, character) => {
    return total + (/\p{Extended_Pictographic}|[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7ff\uf900-\ufaff\ufe10-\ufe6f\uff00-\uff60]/u.test(character) ? 2 : 1);
  }, 0);
  const urls = text.match(/https?:\/\/[^\s]+/gu) ?? [];
  return weightedText + urls.length * 23;
}

function countBlueskyCharacters(text: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return [...segmenter.segment(text)].length;
}

export function countPostCharacters(network: SocialNetwork, text: string): number {
  if (network === "X") return countXCharacters(text);
  if (network === "Bluesky") return countBlueskyCharacters(text);
  return [...text].length;
}

export function validatePost(network: SocialNetwork, text: string): { valid: boolean; count: number; limit: number; message: string } {
  const count = countPostCharacters(network, text);
  const limit = LIMITS[network];
  return {
    valid: count <= limit,
    count,
    limit,
    message: count > limit ? `Supera el límite de ${network} por ${count - limit} caracteres.` : `${count} / ${limit} caracteres`,
  };
}
