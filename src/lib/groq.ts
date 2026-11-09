import {
  OpenAICompatibleProvider,
  createDefaultLLMChain,
  GROQ_CHAT_COMPLETIONS_URL,
  GROQ_MODELS_URL,
  type PostGenerationInput,
  type GeneratedPost,
  type LLMAttemptHandler,
} from "./llm-provider";

export {
  type ApprovedStyleExample,
  type PostGenerationInput,
  type GeneratedPost,
  type LLMAttemptRecord,
  type LLMAttemptHandler,
  type TokenUsage,
  type GroqModelEntry,
  PostGenerationError,
  buildFallbackDraftText,
  buildMessages,
  isEligibleGroqChatModel,
  computeGroqModelCostScore,
  selectGroqCandidateModels,
  isReasoningModel,
} from "./llm-provider";

export type GroqGenerationConfig = {
  apiKey?: string;
  model?: string;
  openAiApiKey?: string;
  openAiModel?: string;
  fetchImpl?: typeof fetch;
  onAttempt?: LLMAttemptHandler;
};

/** Generate and deterministically validate one platform-specific post using Groq. */
export async function generateSocialPost(
  input: PostGenerationInput,
  config: GroqGenerationConfig = {},
): Promise<GeneratedPost> {
  const provider = new OpenAICompatibleProvider(
    "groq",
    "Groq",
    GROQ_CHAT_COMPLETIONS_URL,
    () => config.apiKey ?? process.env.GROQ_API_KEY,
    () => config.model ?? process.env.GROQ_MODEL,
    GROQ_MODELS_URL,
  );
  return provider.generate(input, config.fetchImpl ?? fetch);
}

/**
 * Generate a platform-specific post using the LLM Fallback Chain:
 * Groq (Primary) -> OpenAI (Fallback) -> Deterministic templates (Safety net).
 */
export async function generateSocialPostOrFallback(
  input: PostGenerationInput,
  config: GroqGenerationConfig = {},
): Promise<GeneratedPost> {
  const chain = createDefaultLLMChain(
    {
      groqApiKey: config.apiKey,
      groqModel: config.model,
      openAiApiKey: config.openAiApiKey,
      openAiModel: config.openAiModel,
    },
    config.onAttempt,
  );
  return chain.generate(input, config.fetchImpl ?? fetch);
}
