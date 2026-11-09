# Groq post generation

## Current behavior

`src/lib/groq.ts` contains a server-side adapter for one platform-specific post. It sends event facts, the account voice and up to three approved style examples to Groq's Chat Completions endpoint. Examples are filtered by account, social network and language before being included in the request. Retrieval queries approved style examples per segment `(account, network, language)` using the compound index on `(owner_id, account_id, network, language, created_at desc)`, retrieving up to three examples per segment independently so high-activity segments never displace examples of another account, network, or language. Event fields are serialized as data and explicitly treated as untrusted content in the prompt.

When a manually entered event is saved with Supabase enabled, `generateReviewPosts` reads the event, enabled accounts and approved examples on the server. It generates only future reminders at 14, 7 and 1 day before the event, at 13:00 Europe/Madrid. Up to four requests run concurrently. Existing event/account/network/reminder combinations are skipped before calling Groq, so retrying after a partial failure does not regenerate drafts already stored.

Every response is checked by the deterministic network validator. Missing server configuration, provider or authorization errors, rate limits, empty, provider-truncated and over-limit output produce a basic deterministic draft instead; it remains in review even in automatic mode. The detail panel identifies new Groq, OpenAI, or fallback drafts and shows a safe error category for a fallback (including when completion is truncated by token limits). It does not display API keys, provider response bodies, or arbitrary exception text. The detail modal also includes a «✨ Reintentar con IA» button allowing the user to re-execute the multi-provider fallback chain (Groq -> OpenAI -> Fallback) on an individual review draft, as well as an interactive date and time picker to manually reschedule the post for another day.
Existing drafts pre-dating this feature have unknown origin; the screen does not infer that they came from Groq. A successfully generated text can still be generic or have been edited later.

The API key is read from `GROQ_API_KEY` on the server (`GROQ_MODEL` is optional); never expose them through `NEXT_PUBLIC_` variables. At generation time, Findly queries `GET https://api.groq.com/openai/v1/models` to discover active text-generation models, excludes audio/speech/guardrail models and low-capacity models, orders the remaining candidates by lowest token cost (`pricing.prompt + pricing.completion`), configures `reasoning_effort: "low"` with a 4,096 completion token budget for reasoning models (such as `openai/gpt-oss-20b`), and automatically retries the next candidate model when a model truncates (`output_truncated`) or exceeds character limits before falling back to OpenAI or deterministic templates. Demo mode uses local templates. In review mode, approval schedules through Buffer and saves the final text as a style example. In automatic mode, successfully generated drafts are approved and dispatched without becoming examples. The dashboard never calls Groq from the browser.

Unit tests inject a mocked `fetch` implementation and mock the generation callback for reminder orchestration. They require no Groq key or external request.

## Work record

1. Researched the existing Supabase account/event/style-example records, language detection, deterministic character validator, and server-action security requirements.
2. Integrated the mockable Groq adapter into the authenticated persistent event workflow; the server loads trusted event/account/example data and skips already-persisted reminder combinations.
3. Verified orchestration and provider behavior with unit tests that use mocked generation and mocked `fetch`, then updated this document. No provider credentials or real service calls are needed for local verification.
