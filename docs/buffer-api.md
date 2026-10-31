# Buffer API adapter

## Research and scope

Buffer's current API is GraphQL at `https://api.buffer.com`. A scheduled post is created with one `channelId`, `schedulingType: automatic`, `mode: customScheduled`, and a `dueAt` ISO 8601 instant in UTC ([scheduled post example](https://developers.buffer.com/examples/create-scheduled-post.html), [scheduling guide](https://developers.buffer.com/guides/posts-and-scheduling.html)). The GraphQL payload is a typed union: `PostActionSuccess` on success or `MutationError` on a handled mutation failure. API-level errors may also appear in the top-level `errors` array ([error-handling guide](https://developers.buffer.com/guides/error-handling.html)).

The adapter in `src/lib/buffer.ts` sends one mutation for one channel and never retries automatically. It accepts an API key from its caller and does not read environment variables, so callers must keep it server-side. It does not discover Buffer channels, convert Madrid wall time to UTC, validate network character limits, or persist the resulting post ID; those responsibilities belong to other layers.

## Outcomes and safe retry behavior

- `kind: "scheduled"` includes Buffer's post ID and the returned text/time. A GraphQL warning can accompany a successful post; inspect `warnings`, but do not create the post again.
- `kind: "rejected"` means Buffer returned a typed `MutationError`; fix the input or channel before submitting again.
- `BufferApiError` represents an API-level GraphQL or HTTP error. Its `outcome` is `rejected` for a known rejection and `unknown` when Buffer reports `UNEXPECTED` without a mutation result.
- `BufferUncertainResultError` means the request may have reached Buffer but the client did not receive a reliable mutation result. Its `retryDisposition` is `reconcile_before_retry`; callers must first inspect the Buffer channel queue using persisted correlation data.
- `BufferInputError` and `BufferConfigurationError` happen before any network request.

Transport failures, timeouts, unreadable responses, server failures, and unrecognizable mutation results are treated conservatively as uncertain. The client provides no retry loop or idempotency key because Buffer's `createPost` mutation does not document one.

## Example

```ts
const client = new BufferClient({ apiKey: process.env.BUFFER_API_KEY ?? "" });
const result = await client.schedulePost({
  channelId: "channel-id-from-buffer",
  text: "Join us next week!",
  dueAt: "2026-11-07T12:00:00.000Z",
});

if (result.kind === "scheduled") {
  // Persist result.post.id before treating the post as fully reconciled.
} else {
  // Surface result.error.type/message for correction; do not retry unchanged.
}
```

Use this module only from server-side code. Callers should persist a local correlation record before issuing the mutation, then persist Buffer's post ID after success. On `BufferUncertainResultError`, look up the pending post in that channel before deciding whether a retry is safe.

## RSI plan

1. Research Buffer's official create-post, scheduling, and error-handling documentation.
2. Define a small injected-fetch adapter for one UTC-scheduled post per channel, with typed mutation/API failures and a separate uncertain-result signal.
3. Verify request construction and error cases with mocked fetch; run lint, unit tests, and the production build; update this document and synchronize the branch before merging.

## Documentation and sync checklist

Before merging this adapter, confirm this guide remains aligned with the implementation and that the PR description records the completed documentation and synchronization stage.
