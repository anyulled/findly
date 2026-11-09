import { validatePost, type SocialNetwork } from "./social-validation";
import type { PostLanguage } from "./language";
import type { PostGenerationInput, GeneratedPost, LLMAttemptHandler } from "./llm-provider";
import { generateSocialPostOrFallback } from "./groq";
import { formatMadridDateTime } from "./madrid-time";
import { unpackLocationAndImage } from "./substack";

export type PostRegenerationInput = {
  post: {
    id: string;
    network: SocialNetwork;
    language: PostLanguage;
    leadDays: 14 | 7 | 1;
  };
  event: {
    title: string;
    startsAt: string;
    location: string;
    description: string;
    eventUrl?: string | null;
  };
  account: {
    id: string;
    name: string;
    voicePrompt?: string | null;
    accountType?: string | null;
  };
  approvedExamples?: Array<{
    text: string;
    accountId: string;
    network: SocialNetwork;
    language: PostLanguage;
  }>;
};

export type PostRegenerationResult = {
  text: string;
  generationOrigin: "groq" | "openai" | "fallback";
  generationErrorCode: string | null;
  lastError: string | null;
};

export type PostGeneratorFn = (
  input: PostGenerationInput,
  config?: { onAttempt?: LLMAttemptHandler },
) => Promise<GeneratedPost>;

export async function regeneratePostContent(
  input: PostRegenerationInput,
  generator: PostGeneratorFn = generateSocialPostOrFallback,
  onAttempt?: LLMAttemptHandler,
): Promise<PostRegenerationResult> {
  const eventTime = formatMadridDateTime(input.event.startsAt);
  const { place } = unpackLocationAndImage(input.event.location);

  const genInput: PostGenerationInput = {
    accountId: input.account.id,
    accountName: input.account.name,
    accountVoice: input.account.voicePrompt ?? "",
    accountKind: input.account.accountType === "personal" ? "Cuenta personal" : undefined,
    network: input.post.network,
    language: input.post.language,
    event: {
      title: input.event.title,
      date: eventTime.date,
      time: eventTime.time,
      place,
      description: input.event.description ?? "",
      url: input.event.eventUrl ?? undefined,
    },
    reminderDays: input.post.leadDays,
    approvedExamples: input.approvedExamples,
  };

  const generated = await generator(genInput, { onAttempt });

  const validation = validatePost(input.post.network, generated.text);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const origin: "groq" | "openai" | "fallback" =
    generated.provider ?? (generated.isFallback ? "fallback" : "groq");
  const errorCode = generated.generationError ?? null;
  const lastError = generated.isFallback
    ? "Generado con plantilla de respaldo (la generación con IA no estuvo disponible o no superó la validación)."
    : null;

  return {
    text: generated.text,
    generationOrigin: origin,
    generationErrorCode: errorCode,
    lastError,
  };
}

export type RegeneratedPostRecordUpdate = {
  content: string;
  generation_origin: "groq" | "openai" | "fallback";
  generation_error_code: string | null;
  last_error: string | null;
  status: "review";
  approved_at: null;
  buffer_post_id: null;
  scheduling_attempt_id: null;
  updated_at: string;
};

/**
 * Builds the database update payload for transitioning a post (from review or failed)
 * into a fresh review draft, explicitly resetting approval and dispatch metadata
 * so that it can be safely discarded or re-approved.
 */
export function buildRegeneratedPostUpdate(
  result: PostRegenerationResult,
  nowIso = new Date().toISOString(),
): RegeneratedPostRecordUpdate {
  return {
    content: result.text,
    generation_origin: result.generationOrigin,
    generation_error_code: result.generationErrorCode,
    last_error: result.lastError,
    status: "review",
    approved_at: null,
    buffer_post_id: null,
    scheduling_attempt_id: null,
    updated_at: nowIso,
  };
}

