# Groq post generation adapter

## Current scope

`src/lib/groq.ts` contains a server-side adapter for one platform-specific post. It sends event facts, the account voice and up to three approved style examples to Groq's Chat Completions endpoint. Examples are filtered by account, social network and language before being included in the request. Event fields are serialized as data and explicitly treated as untrusted content in the prompt.

The returned text is checked with the deterministic social-network validator. An empty response, provider error, missing configuration or over-limit result fails without creating a draft. The API key and model are read from server environment variables and must not be exposed through `NEXT_PUBLIC_` variables.

## Not connected yet

The dashboard still creates its drafts from local templates. A later server action should load the event, account voice and approved examples from Supabase, call this adapter, then persist only validated content. Integration tests can inject a mocked `fetch` implementation; they do not require a Groq key or external request.

## RSI plan

1. Research Groq's current chat-completions contract and the existing account, language and character-validation model.
2. Implement a small fetch-based adapter with injected configuration, filtered style examples, and deterministic output validation.
3. Verify request construction and failure handling with mocked responses, document the integration seam, then synchronize and open a pull request.
