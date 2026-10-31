import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateSocialPost, PostGenerationError, type PostGenerationInput } from "../src/lib/groq";

const input: PostGenerationInput = {
  accountId: "account-1",
  accountName: "BarcelonaJS",
  accountVoice: "Warm, informal, and welcoming.",
  network: "Bluesky",
  language: "en",
  event: {
    title: "Community Night",
    date: "2026-11-12",
    time: "19:00",
    place: "Barcelona",
    description: "Meet local developers and share ideas.",
    url: "https://example.org/event",
  },
  reminderDays: 7,
  approvedExamples: [
    { accountId: "account-1", network: "Bluesky", language: "en", text: "Matching style example." },
    { accountId: "account-2", network: "Bluesky", language: "en", text: "Different account." },
    { accountId: "account-1", network: "X", language: "en", text: "Different network." },
    { accountId: "account-1", network: "Bluesky", language: "es", text: "Different language." },
  ],
};

function response(content: unknown, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
}

describe("generateSocialPost", () => {
  it("sends account-matched context to Groq and validates its response", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const fetchImpl: typeof fetch = async (url, init) => {
      request = { url: String(url), init };
      return response("Join us next week for Community Night in Barcelona!");
    };

    const result = await generateSocialPost(input, { apiKey: "mock-secret", model: "mock-model", fetchImpl });

    assert.equal(result.text, "Join us next week for Community Night in Barcelona!");
    assert.equal(result.validation.valid, true);
    assert.equal(request?.url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(new Headers(request?.init?.headers).get("authorization"), "Bearer mock-secret");
    const body = JSON.parse(String(request?.init?.body)) as { model: string; messages: Array<{ role: string; content: string }> };
    assert.equal(body.model, "mock-model");
    assert.match(body.messages[0].content, /BarcelonaJS/u);
    assert.match(body.messages[0].content, /English/u);
    assert.match(body.messages[0].content, /Europe\/Madrid/u);
    assert.match(body.messages[1].content, /Matching style example\./u);
    assert.doesNotMatch(body.messages[1].content, /Different account\./u);
    assert.doesNotMatch(body.messages[1].content, /Different network\./u);
    assert.doesNotMatch(body.messages[1].content, /Different language\./u);
  });

  it("fails safely when server configuration is missing", async () => {
    await assert.rejects(generateSocialPost(input, { apiKey: "", model: "" }), { code: "not_configured" });
  });

  it("does not expose provider response details when Groq rejects a request", async () => {
    const fetchImpl: typeof fetch = async () => response("private provider detail", 429);

    await assert.rejects(generateSocialPost(input, { apiKey: "mock-secret", model: "mock-model", fetchImpl }), {
      message: "Groq returned HTTP 429. The draft was not created.",
    });
    await assert.rejects(generateSocialPost(input, { apiKey: "mock-secret", model: "mock-model", fetchImpl }),
      (error: Error) => !error.message.includes("private provider detail"));
  });

  it("rejects empty and over-limit output", async () => {
    const emptyFetch: typeof fetch = async () => response("  ");
    const longFetch: typeof fetch = async () => response("x".repeat(301));

    await assert.rejects(generateSocialPost(input, { apiKey: "mock-secret", model: "mock-model", fetchImpl: emptyFetch }),
      { code: "empty_response" });
    await assert.rejects(generateSocialPost(input, { apiKey: "mock-secret", model: "mock-model", fetchImpl: longFetch }),
      (error: Error) => error instanceof PostGenerationError
        && error.code === "over_limit"
        && error.validation?.valid === false
        && error.validation.limit === 300);
  });

  it("returns a typed provider error when the request fails", async () => {
    const fetchImpl: typeof fetch = async () => { throw new Error("network details"); };

    await assert.rejects(generateSocialPost(input, { apiKey: "mock-secret", model: "mock-model", fetchImpl }),
      (error: Error) => error instanceof PostGenerationError
        && error.code === "provider_error"
        && !error.message.includes("network details"));
  });
});
