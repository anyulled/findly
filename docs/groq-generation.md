# Groq post generation

## Current behavior

`src/lib/groq.ts` contains a server-side adapter for one platform-specific post. It sends event facts, the account voice and up to three approved style examples to Groq's Chat Completions endpoint. Examples are filtered by account, social network and language before being included in the request. Event fields are serialized as data and explicitly treated as untrusted content in the prompt.

When a manually entered event is saved with Supabase enabled, `generateReviewPosts` reads the event, enabled accounts and approved examples on the server. It generates only future reminders at 14, 7 and 1 day before the event, at 13:00 Europe/Madrid. Up to four requests run concurrently. Existing event/account/network/reminder combinations are skipped before calling Groq, so retrying after a partial failure does not regenerate drafts already stored.

Every response is checked by the deterministic network validator. Missing server configuration, provider or authorization errors, rate limits, empty, provider-truncated and over-limit output produce a basic deterministic draft instead; it remains in review even in automatic mode. The detail panel identifies new Groq or fallback drafts and shows a safe error category for a fallback. It does not display API keys, provider response bodies, or arbitrary exception text. Existing drafts pre-dating this feature have unknown origin; the screen does not infer that they came from Groq. A successfully generated text can still be generic or have been edited later.

The API key and model are read from `GROQ_API_KEY` and `GROQ_MODEL` on the server; never expose them through `NEXT_PUBLIC_` variables. Demo mode uses local templates. In review mode, approval schedules through Buffer and saves the final text as a style example. In automatic mode, successfully generated drafts are approved and dispatched without becoming examples. The dashboard never calls Groq from the browser.

Unit tests inject a mocked `fetch` implementation and mock the generation callback for reminder orchestration. They require no Groq key or external request.

## Work record

1. Researched the existing Supabase account/event/style-example records, language detection, deterministic character validator, and server-action security requirements.
2. Integrated the mockable Groq adapter into the authenticated persistent event workflow; the server loads trusted event/account/example data and skips already-persisted reminder combinations.
3. Verified orchestration and provider behavior with unit tests that use mocked generation and mocked `fetch`, then updated this document. No provider credentials or real service calls are needed for local verification.
