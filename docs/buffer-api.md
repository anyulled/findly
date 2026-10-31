# Buffer API adapter

## Research and scope

Buffer's current API is GraphQL at `https://api.buffer.com`. A scheduled post is created with one `channelId`, `schedulingType: automatic`, `mode: customScheduled`, and a `dueAt` ISO 8601 instant in UTC ([scheduled post example](https://developers.buffer.com/examples/create-scheduled-post.html), [scheduling guide](https://developers.buffer.com/guides/posts-and-scheduling.html)). The GraphQL payload is a typed union: `PostActionSuccess` on success or `MutationError` on a handled mutation failure. API-level errors may also appear in the top-level `errors` array ([error-handling guide](https://developers.buffer.com/guides/error-handling.html)).

The adapter in `src/lib/buffer.ts` sends one mutation for one channel and never retries automatically. It accepts an API key from its caller and does not read environment variables, so callers must keep it server-side. The dashboard stores a separate Buffer channel ID for each account/network pair. It converts the persisted `due_at` instant to UTC, checks the deterministic network character limit before sending, and persists Buffer's post ID only after a confirmed success. Channel discovery remains manual.

## Outcomes and safe retry behavior

- `kind: "scheduled"` includes Buffer's post ID and the returned text/time. A GraphQL warning can accompany a successful post; inspect `warnings`, but do not create the post again.
- `kind: "rejected"` means Buffer returned a typed `MutationError`; fix the input or channel before submitting again.
- `BufferApiError` represents an API-level GraphQL or HTTP error. Its `outcome` is `rejected` for a known rejection and `unknown` when Buffer reports `UNEXPECTED` without a mutation result.
- `BufferUncertainResultError` means the request may have reached Buffer but the client did not receive a reliable mutation result. Its `retryDisposition` is `reconcile_before_retry`; callers must first inspect the Buffer channel queue using persisted correlation data.
- `BufferInputError` and `BufferConfigurationError` happen before any network request.

Transport failures, timeouts, unreadable responses, server failures, and unrecognizable mutation results are treated conservatively as uncertain. The client provides no retry loop or idempotency key because Buffer's `createPost` mutation does not document one.

The persistence workflow claims an `approved` post as `scheduling` before calling Buffer, so overlapping calls cannot submit it twice. Confirmed success stores the Buffer post ID and changes the state to `scheduled`. A known rejection is stored as `failed` and may be explicitly retried after correction. An uncertain response is stored as `needs_reconciliation` and is never retried automatically. Findly provides reconciliation actions to record the Buffer post ID after the owner verifies it in the matching channel, or explicitly confirm absence after checking the queue before allowing a retry. A process crash after claiming but before recording a result leaves the post in `scheduling`; check Buffer before taking action. The Luma cron importer uses a service-role-only claim/update path with an explicit owner ID, and only queries owner-approved posts for that event; uncertain and failed records are not retried by cron. `scheduled` means accepted by Buffer, not published by the social network.

Review approval first atomically saves the final text as the account/network/language style example, then schedules that single post. In global automatic mode, newly generated posts are claimed and scheduled immediately without adding style examples. Demo mode never contacts Buffer. `published` is not set by this integration.

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

Use this module only from server-side code. The application requires `BUFFER_API_KEY` and an explicit account/network channel mapping. On `BufferUncertainResultError`, look up the pending post in the matching Buffer channel and record its ID in Findly if present. Do not retry an uncertain post.

## Verification and limits

The GraphQL client and persisted approval/automatic workflows are covered by unit tests with mocked Buffer fetches and mocked Supabase RPCs. This verifies request construction, channel selection, UTC scheduling, confirmed-ID persistence, rejection handling, and uncertain-result duplicate prevention. The repository has no real Buffer API key or connected channels, so these tests do not verify live account permissions or social network publication. The owner must verify channel IDs and the Buffer queue before production use.
