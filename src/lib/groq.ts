import {
  OpenAICompatibleProvider,
  createDefaultLLMChain,
  type PostGenerationInput,
  type GeneratedPost,
} from "./llm-provider";

export {
  type ApprovedStyleExample,
  type PostGenerationInput,
  type GeneratedPost,
  PostGenerationError,
  buildFallbackDraftText,
  buildMessages,
} from "./llm-provider";

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";

export type GroqGenerationConfig = {
  apiKey?: string;
  model?: string;
  openAiApiKey?: string;
  openAiModel?: string;
  fetchImpl?: typeof fetch;
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
  const chain = createDefaultLLMChain({
    groqApiKey: config.apiKey,
    groqModel: config.model,
    openAiApiKey: config.openAiApiKey,
    openAiModel: config.openAiModel,
  });
  return chain.generate(input, config.fetchImpl ?? fetch);
}
