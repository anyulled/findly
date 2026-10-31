# Groq post generation

## Current behavior

`src/lib/groq.ts` contains a server-side adapter for one platform-specific post. It sends event facts, the account voice and up to three approved style examples to Groq's Chat Completions endpoint. Examples are filtered by account, social network and language before being included in the request. Event fields are serialized as data and explicitly treated as untrusted content in the prompt.

When a manually entered event is saved with Supabase enabled, `generateReviewPosts` reads the event, enabled accounts and approved examples on the server. It generates only future reminders at 14, 7 and 1 day before the event, at 13:00 Europe/Madrid. Up to four requests run concurrently. Existing event/account/network/reminder combinations are skipped before calling Groq, so retrying after a partial failure does not regenerate drafts already stored.

The returned text is checked with the deterministic social-network validator before any draft from the request is saved. An empty response, provider error, missing configuration or over-limit result fails the generation request. The API key and model are read from server environment variables and must not be exposed through `NEXT_PUBLIC_` variables. Persistent-mode draft generation requires `GROQ_API_KEY` and `GROQ_MODEL`; local demo mode continues to use deterministic templates.

All generated drafts start in review status. Approving an edited post stores its final text as the style example for later generations. The global automatic mode does not publish or schedule posts yet; Buffer scheduling remains a separate integration. The dashboard does not read the API key or call Groq from the browser.

Unit tests inject a mocked `fetch` implementation and mock the generation callback for reminder orchestration. They require no Groq key or external request.

## Work record

1. Researched the existing Supabase account/event/style-example records, language detection, deterministic character validator, and server-action security requirements.
2. Integrated the mockable Groq adapter into the authenticated persistent event workflow; the server loads trusted event/account/example data and skips already-persisted reminder combinations.
3. Verified orchestration and provider behavior with unit tests that use mocked generation and mocked `fetch`, then updated this document. No provider credentials or real service calls are needed for local verification.
