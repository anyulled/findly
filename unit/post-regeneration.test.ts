import test from "node:test";
import assert from "node:assert/strict";
import { regeneratePostContent, buildRegeneratedPostUpdate, type PostRegenerationInput } from "../src/lib/post-regeneration";
import type { GeneratedPost, LLMAttemptRecord } from "../src/lib/llm-provider";

const sampleInput: PostRegenerationInput = {
  post: {
    id: "post-1",
    network: "X",
    language: "es",
    leadDays: 1,
  },
  event: {
    title: "El temblor del mundo",
    startsAt: "2026-11-02T13:00:00.000Z",
    location: "Online",
    description: "Un debate dialéctico sobre la condición humana.",
    eventUrl: "https://etsideusnondaretur.substack.com/p/el-temblor",
  },
  account: {
    id: "acc-1",
    name: "Personal",
    voicePrompt: "Cercano y reflexivo",
    accountType: "personal",
  },
  approvedExamples: [],
};

test("regeneratePostContent successfully generates with OpenAI provider", async () => {
  const attempts: LLMAttemptRecord[] = [];
  const mockGenerator = async (): Promise<GeneratedPost> => ({
    text: "Les comparto una reflexión sobre el temblor del mundo https://etsideusnondaretur.substack.com/p/el-temblor",
    model: "gpt-6-luna",
    provider: "openai",
    validation: { valid: true, count: 110, limit: 280, message: "110 / 280 caracteres" },
  });

  const result = await regeneratePostContent(
    sampleInput,
    mockGenerator,
    (att) => {
      attempts.push(att);
    },
  );

  assert.equal(result.generationOrigin, "openai");
  assert.equal(result.generationErrorCode, null);
  assert.equal(result.lastError, null);
  assert.match(result.text, /el temblor/i);
});

test("regeneratePostContent successfully generates with Groq provider", async () => {
  const mockGenerator = async (): Promise<GeneratedPost> => ({
    text: "Nuevo episodio publicado: El temblor del mundo https://etsideusnondaretur.substack.com/p/el-temblor",
    model: "openai/gpt-oss-20b",
    provider: "groq",
    validation: { valid: true, count: 105, limit: 280, message: "105 / 280 caracteres" },
  });

  const result = await regeneratePostContent(sampleInput, mockGenerator);

  assert.equal(result.generationOrigin, "groq");
  assert.equal(result.generationErrorCode, null);
  assert.equal(result.lastError, null);
});

test("regeneratePostContent handles fallback generation and surfaces error code", async () => {
  const mockGenerator = async (): Promise<GeneratedPost> => ({
    text: "El temblor del mundo https://etsideusnondaretur.substack.com/p/el-temblor",
    model: "fallback",
    provider: "fallback",
    isFallback: true,
    generationError: "output_truncated",
    validation: { valid: true, count: 70, limit: 280, message: "70 / 280 caracteres" },
  });

  const result = await regeneratePostContent(sampleInput, mockGenerator);

  assert.equal(result.generationOrigin, "fallback");
  assert.equal(result.generationErrorCode, "output_truncated");
  assert.match(result.lastError ?? "", /plantilla de respaldo/i);
});

test("regeneratePostContent throws when generated text fails deterministic validation", async () => {
  const mockGenerator = async (): Promise<GeneratedPost> => ({
    text: "A".repeat(300), // Exceeds X limit of 280
    model: "gpt-6-luna",
    provider: "openai",
    validation: { valid: false, count: 300, limit: 280, message: "Demasiado largo" },
  });

  await assert.rejects(
    () => regeneratePostContent(sampleInput, mockGenerator),
    /límite|caracteres/i,
  );
});

test("buildRegeneratedPostUpdate explicitly resets approval and dispatch metadata for review transition", () => {
  const fixedIso = "2026-11-09T16:30:00.000Z";
  const result = {
    text: "Nuevo borrador regenerado",
    generationOrigin: "groq" as const,
    generationErrorCode: null,
    lastError: null,
  };

  const update = buildRegeneratedPostUpdate(result, fixedIso);

  assert.deepEqual(update, {
    content: "Nuevo borrador regenerado",
    generation_origin: "groq",
    generation_error_code: null,
    last_error: null,
    status: "review",
    approved_at: null,
    buffer_post_id: null,
    scheduling_attempt_id: null,
    updated_at: fixedIso,
  });
});

