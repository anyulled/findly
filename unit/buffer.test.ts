import assert from "node:assert/strict";
import test from "node:test";
import {
  BufferApiError,
  BufferClient,
  BufferConfigurationError,
  BufferInputError,
  BufferUncertainResultError,
} from "../src/lib/buffer";

const scheduledAt = "2026-11-07T12:00:00.000Z";
const input = { channelId: "channel-123", text: "A scheduled post", dueAt: scheduledAt };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("sends one customScheduled UTC mutation to one channel and returns the created post", async () => {
  let calls = 0;
  let requestBody: Record<string, unknown> | undefined;
  let authorization: string | null = null;
  const client = new BufferClient({
    apiKey: " test-api-key ",
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(url, "https://api.buffer.com");
      assert.equal(init?.method, "POST");
      authorization = new Headers(init?.headers).get("Authorization");
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response({
        data: {
          createPost: {
            __typename: "PostActionSuccess",
            post: { id: "buffer-post-1", text: input.text, dueAt: scheduledAt },
          },
        },
      });
    },
  });

  const result = await client.schedulePost(input);

  assert.equal(calls, 1);
  assert.equal(authorization, "Bearer test-api-key");
  assert.deepEqual(requestBody?.variables, {
    input: {
      ...input,
      schedulingType: "automatic",
      mode: "customScheduled",
    },
  });
  assert.deepEqual(result, {
    kind: "scheduled",
    post: { id: "buffer-post-1", text: input.text, dueAt: scheduledAt },
    warnings: [],
  });
});

test("preserves GraphQL warnings when Buffer confirms the post was created", async () => {
  const client = new BufferClient({
    apiKey: "test-api-key",
    fetchImpl: async () => response({
      data: {
        createPost: {
          __typename: "PostActionSuccess",
          post: { id: "buffer-post-2", text: input.text, dueAt: scheduledAt },
        },
      },
      errors: [{ message: "Non-blocking warning", extensions: { code: "WARNING" } }],
    }),
  });

  const result = await client.schedulePost(input);

  assert.equal(result.kind, "scheduled");
  if (result.kind === "scheduled") {
    assert.deepEqual(result.warnings, [{ message: "Non-blocking warning", code: "WARNING" }]);
  }
});

test("returns a typed Buffer mutation rejection without retrying", async () => {
  let calls = 0;
  const client = new BufferClient({
    apiKey: "test-api-key",
    fetchImpl: async () => {
      calls += 1;
      return response({ data: { createPost: { __typename: "LimitReachedError", message: "Channel queue is full" } } });
    },
  });

  const result = await client.schedulePost(input);

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    kind: "rejected",
    error: { type: "LimitReachedError", message: "Channel queue is full" },
  });
});

test("exposes GraphQL API error codes as typed API failures", async () => {
  const client = new BufferClient({
    apiKey: "test-api-key",
    fetchImpl: async () => response({
      data: null,
      errors: [{ message: "Not authorized", extensions: { code: "UNAUTHORIZED" } }],
    }),
  });

  await assert.rejects(client.schedulePost(input), (error: unknown) => {
    assert.ok(error instanceof BufferApiError);
    assert.equal(error.kind, "api");
    assert.equal(error.code, "UNAUTHORIZED");
    assert.equal(error.outcome, "rejected");
    return true;
  });
});

test("marks Buffer UNEXPECTED GraphQL errors as having an unknown outcome", async () => {
  const client = new BufferClient({
    apiKey: "test-api-key",
    fetchImpl: async () => response({
      errors: [{ message: "Unexpected error", extensions: { code: "UNEXPECTED" } }],
    }),
  });

  await assert.rejects(client.schedulePost(input), (error: unknown) => {
    assert.ok(error instanceof BufferApiError);
    assert.equal(error.outcome, "unknown");
    return true;
  });
});

test("marks transport failures as uncertain and requires reconciliation before retry", async () => {
  const client = new BufferClient({
    apiKey: "test-api-key",
    fetchImpl: async () => { throw new Error("connection reset"); },
  });

  await assert.rejects(client.schedulePost(input), (error: unknown) => {
    assert.ok(error instanceof BufferUncertainResultError);
    assert.equal(error.kind, "uncertain");
    assert.equal(error.retryDisposition, "reconcile_before_retry");
    return true;
  });
});

test("marks server errors and unreadable success responses as uncertain", async (t) => {
  await t.test("server error", async () => {
    const client = new BufferClient({
      apiKey: "test-api-key",
      fetchImpl: async () => response({ errors: [{ message: "Temporary server failure" }] }, 503),
    });
    await assert.rejects(client.schedulePost(input), BufferUncertainResultError);
  });

  await t.test("server error with a success-shaped payload", async () => {
    const client = new BufferClient({
      apiKey: "test-api-key",
      fetchImpl: async () => response({
        data: { createPost: { __typename: "PostActionSuccess", post: { id: "post-1", text: input.text } } },
      }, 500),
    });
    await assert.rejects(client.schedulePost(input), BufferUncertainResultError);
  });

  await t.test("unreadable successful response", async () => {
    const client = new BufferClient({
      apiKey: "test-api-key",
      fetchImpl: async () => new Response("not json", { status: 200 }),
    });
    await assert.rejects(client.schedulePost(input), BufferUncertainResultError);
  });

  await t.test("unrecognized mutation payload", async () => {
    const client = new BufferClient({
      apiKey: "test-api-key",
      fetchImpl: async () => response({ data: { createPost: { unexpected: true } } }),
    });
    await assert.rejects(client.schedulePost(input), BufferUncertainResultError);
  });

  await t.test("null JSON response", async () => {
    const client = new BufferClient({
      apiKey: "test-api-key",
      fetchImpl: async () => response(null),
    });
    await assert.rejects(client.schedulePost(input), BufferUncertainResultError);
  });
});

test("rejects invalid inputs and missing credentials before sending a request", async () => {
  assert.throws(() => new BufferClient({ apiKey: " " }), BufferConfigurationError);

  let calls = 0;
  const client = new BufferClient({
    apiKey: "test-api-key",
    fetchImpl: async () => {
      calls += 1;
      return response({});
    },
  });

  await assert.rejects(client.schedulePost({ ...input, dueAt: "2026-11-07T13:00:00+01:00" }), BufferInputError);
  await assert.rejects(client.schedulePost({ ...input, dueAt: "2026-02-30T12:00:00.000Z" }), BufferInputError);
  await assert.rejects(client.schedulePost({ ...input, channelId: " " }), BufferInputError);
  await assert.rejects(client.schedulePost({ ...input, imageUrl: "http://insecure.example.com/img.png" }), BufferInputError);
  assert.equal(calls, 0);
});

test("supports addToQueue mode without dueAt and attaches imageUrl as ImageAsset", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const client = new BufferClient({
    apiKey: "test-api-key",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response({
        data: {
          createPost: {
            __typename: "PostActionSuccess",
            post: { id: "buffer-post-queue", text: "Substack post", dueAt: scheduledAt },
          },
        },
      });
    },
  });

  const result = await client.schedulePost({
    channelId: "channel-123",
    text: "Substack post",
    mode: "addToQueue",
    imageUrl: "https://substackcdn.com/image/cover.jpg",
  });

  assert.equal(result.kind, "scheduled");
  assert.deepEqual(requestBody?.variables, {
    input: {
      channelId: "channel-123",
      text: "Substack post",
      schedulingType: "automatic",
      mode: "addToQueue",
      assets: [
        {
          image: {
            url: "https://substackcdn.com/image/cover.jpg",
            thumbnailUrl: "https://substackcdn.com/image/cover.jpg",
          },
        },
      ],
    },
  });
});
