import assert from "node:assert/strict";
import test from "node:test";
import {
  computeNextSlotFromSchedule,
  fetchNextChannelSlotsForAccount,
  fetchScheduledPostsForAccount,
  mapServiceToNetwork,
  syncBufferScheduledPosts,
  type BufferSyncAccount,
} from "../src/lib/buffer-sync";

test("mapServiceToNetwork maps known social network services", () => {
  assert.equal(mapServiceToNetwork("twitter"), "X");
  assert.equal(mapServiceToNetwork("Twitter"), "X");
  assert.equal(mapServiceToNetwork("x"), "X");
  assert.equal(mapServiceToNetwork("linkedin"), "LinkedIn");
  assert.equal(mapServiceToNetwork("LinkedIn"), "LinkedIn");
  assert.equal(mapServiceToNetwork("bluesky"), "Bluesky");
  assert.equal(mapServiceToNetwork("instagram"), null);
  assert.equal(mapServiceToNetwork("facebook"), null);
});

test("fetchScheduledPostsForAccount returns empty results when API key is missing or blank", async () => {
  const result1 = await fetchScheduledPostsForAccount("", "Personal", "acc-1");
  assert.deepEqual(result1, { posts: [], channels: [] });

  const result2 = await fetchScheduledPostsForAccount("   ", "Personal", "acc-1");
  assert.deepEqual(result2, { posts: [], channels: [] });
});

test("fetchScheduledPostsForAccount returns empty results on network failure or HTTP errors", async () => {
  const mockFetchNetworkError: typeof fetch = async () => {
    throw new Error("Network offline");
  };
  const result1 = await fetchScheduledPostsForAccount("valid-key", "Personal", "acc-1", mockFetchNetworkError);
  assert.deepEqual(result1, { posts: [], channels: [] });

  const mockFetchHttp500: typeof fetch = async () => {
    return new Response("Internal Server Error", { status: 500 });
  };
  const result2 = await fetchScheduledPostsForAccount("valid-key", "Personal", "acc-1", mockFetchHttp500);
  assert.deepEqual(result2, { posts: [], channels: [] });
});

test("fetchScheduledPostsForAccount returns empty results when no organization is found", async () => {
  const mockFetchNoOrg: typeof fetch = async () => {
    return new Response(JSON.stringify({ data: { account: { organizations: [] } } }), { status: 200 });
  };
  const result = await fetchScheduledPostsForAccount("valid-key", "Personal", "acc-1", mockFetchNoOrg);
  assert.deepEqual(result, { posts: [], channels: [] });
});

test("fetchScheduledPostsForAccount discovers channels and retrieves scheduled posts", async () => {
  const mockFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(init?.body as string) as { query: string };
    if (body.query.includes("organizations")) {
      return new Response(JSON.stringify({
        data: {
          account: {
            organizations: [{ id: "org-123", name: "My Org" }],
          },
        },
      }), { status: 200 });
    }
    if (body.query.includes("GetChannels")) {
      return new Response(JSON.stringify({
        data: {
          channels: [
            { id: "chan-x", name: "My X", service: "twitter" },
            { id: "chan-li", name: "My LinkedIn", service: "linkedin" },
            { id: "chan-bs", name: "My Bluesky", service: "bluesky" },
            { id: "chan-ig", name: "My Instagram", service: "instagram" },
          ],
        },
      }), { status: 200 });
    }
    if (body.query.includes("GetScheduledPosts")) {
      return new Response(JSON.stringify({
        data: {
          posts: {
            edges: [
              {
                node: {
                  id: "post-1",
                  text: "Hello from Bluesky",
                  dueAt: "2026-11-02T13:00:00.000Z",
                  channelId: "chan-bs",
                  status: "scheduled",
                },
              },
              {
                node: {
                  id: "post-2",
                  text: "Hello from X",
                  dueAt: "2026-11-02T14:00:00.000Z",
                  channelId: "chan-x",
                  status: "scheduled",
                },
              },
              {
                node: {
                  id: "post-3",
                  text: "Unknown channel",
                  dueAt: "2026-11-02T15:00:00.000Z",
                  channelId: "chan-unknown",
                  status: "scheduled",
                },
              },
              {
                node: {
                  id: "post-4",
                  text: "",
                  dueAt: "2026-11-02T16:00:00.000Z",
                  channelId: "chan-li",
                  status: "scheduled",
                },
              },
            ],
          },
        },
      }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  const result = await fetchScheduledPostsForAccount("valid-key", "Personal", "acc-1", mockFetch);
  assert.equal(result.channels.length, 3);
  assert.deepEqual(result.channels[0], { network: "X", channelId: "chan-x", channelName: "My X" });
  assert.deepEqual(result.channels[1], { network: "LinkedIn", channelId: "chan-li", channelName: "My LinkedIn" });
  assert.deepEqual(result.channels[2], { network: "Bluesky", channelId: "chan-bs", channelName: "My Bluesky" });

  assert.equal(result.posts.length, 2);
  assert.deepEqual(result.posts[0], {
    id: "post-1",
    bufferPostId: "post-1",
    accountName: "Personal",
    accountId: "acc-1",
    network: "Bluesky",
    text: "Hello from Bluesky",
    dueAt: "2026-11-02T13:00:00.000Z",
  });
  assert.deepEqual(result.posts[1], {
    id: "post-2",
    bufferPostId: "post-2",
    accountName: "Personal",
    accountId: "acc-1",
    network: "X",
    text: "Hello from X",
    dueAt: "2026-11-02T14:00:00.000Z",
  });
});

test("syncBufferScheduledPosts aggregates posts across accounts and links matching events", async () => {
  const discovered: Array<{ accountId: string; network: string; channelId: string }> = [];

  const mockFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(init?.body as string) as { query: string };
    if (body.query.includes("organizations")) {
      return new Response(JSON.stringify({
        data: { account: { organizations: [{ id: "org-1", name: "Org" }] } },
      }), { status: 200 });
    }
    if (body.query.includes("GetChannels")) {
      return new Response(JSON.stringify({
        data: {
          channels: [{ id: "chan-x", name: "X", service: "twitter" }],
        },
      }), { status: 200 });
    }
    if (body.query.includes("GetScheduledPosts")) {
      return new Response(JSON.stringify({
        data: {
          posts: {
            edges: [
              {
                node: {
                  id: "post-existing",
                  text: "Already stored in DB",
                  dueAt: "2026-11-02T13:00:00.000Z",
                  channelId: "chan-x",
                  status: "scheduled",
                },
              },
              {
                node: {
                  id: "post-new",
                  text: "Join us for Lightning Talks: Java 27!",
                  dueAt: "2026-11-05T11:00:00.000Z",
                  channelId: "chan-x",
                  status: "scheduled",
                },
              },
            ],
          },
        },
      }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  const accounts: BufferSyncAccount[] = [
    { id: "acc-no-key", name: "Empty", apiKey: null, bufferChannels: {} },
    { id: "acc-with-key", name: "Barcelona JUG", apiKey: "valid-key", bufferChannels: {} },
  ];
  const events = [{ id: "event-java-27", title: "Lightning Talks: Java 27" }];
  const existingBufferPostIds = new Set(["post-existing"]);

  const posts = await syncBufferScheduledPosts(
    accounts,
    events,
    existingBufferPostIds,
    async (accountId, network, channelId) => {
      discovered.push({ accountId, network, channelId });
    },
    mockFetch,
  );

  // Channel discovery callback fired
  assert.equal(discovered.length, 1);
  assert.deepEqual(discovered[0], { accountId: "acc-with-key", network: "X", channelId: "chan-x" });
  assert.equal(accounts[1].bufferChannels.X, "chan-x");

  // Only post-new was added (post-existing was skipped)
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, "buffer-post-new");
  assert.equal(posts[0].bufferPostId, "post-new");
  assert.equal(posts[0].account, "Barcelona JUG");
  assert.equal(posts[0].eventId, "event-java-27");
  assert.equal(posts[0].date, "2026-11-05");
  assert.equal(posts[0].time, "12:00");
  assert.equal(posts[0].status, "scheduled");
});

test("syncBufferScheduledPosts survives onChannelDiscovered error and fetch error", async () => {
  const mockFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(init?.body as string) as { query: string };
    if (body.query.includes("organizations")) {
      return new Response(JSON.stringify({
        data: { account: { organizations: [{ id: "org-1", name: "Org" }] } },
      }), { status: 200 });
    }
    if (body.query.includes("GetChannels")) {
      return new Response(JSON.stringify({
        data: { channels: [{ id: "chan-1", name: "X", service: "twitter" }] },
      }), { status: 200 });
    }
    return new Response("Error", { status: 500 });
  };

  const accounts: BufferSyncAccount[] = [
    { id: "acc-1", name: "Personal", apiKey: "key", bufferChannels: {} },
  ];

  const posts = await syncBufferScheduledPosts(
    accounts,
    [],
    new Set(),
    async () => {
      throw new Error("DB upsert failed");
    },
    mockFetch,
  );

  assert.deepEqual(posts, []);
  assert.equal(accounts[0].bufferChannels.X, "chan-1");
});

test("computeNextSlotFromSchedule picks the earliest available slot and skips occupied slots", () => {
  const now = new Date("2026-11-01T10:00:00.000Z"); // Sunday Nov 1, 2026 11:00 Madrid
  const schedule = [
    { day: "mon", times: ["09:00", "14:00"], paused: false },
    { day: "tue", times: ["12:00"], paused: false },
    { day: "sun", times: ["18:00"], paused: true },
  ];
  const slot1 = computeNextSlotFromSchedule("X", schedule, new Set(), now);
  assert.deepEqual(slot1, { date: "2026-11-02", time: "09:00" });

  const slot2 = computeNextSlotFromSchedule("X", schedule, new Set(["2026-11-02T09:00"]), now);
  assert.deepEqual(slot2, { date: "2026-11-02", time: "14:00" });

  // Empty schedule falls back to default network time (13:14 for LinkedIn)
  const fallback = computeNextSlotFromSchedule("LinkedIn", [], new Set(), now);
  assert.deepEqual(fallback, { date: "2026-11-01", time: "13:14" });
});

test("fetchNextChannelSlotsForAccount queries Buffer schedule and scheduled posts", async () => {
  const now = new Date("2026-11-01T10:00:00.000Z");
  const mockFetch: typeof fetch = async (_url, init) => {
    const body = JSON.parse(init?.body as string) as { query: string };
    if (body.query.includes("organizations")) {
      return new Response(JSON.stringify({
        data: { account: { organizations: [{ id: "org-1", name: "Org" }] } },
      }), { status: 200 });
    }
    if (body.query.includes("GetChannels")) {
      return new Response(JSON.stringify({
        data: {
          channels: [
            {
              id: "chan-x",
              name: "X",
              service: "twitter",
              postingSchedule: [{ day: "mon", times: ["14:00"], paused: false }],
            },
          ],
        },
      }), { status: 200 });
    }
    if (body.query.includes("GetScheduledPosts")) {
      return new Response(JSON.stringify({
        data: {
          posts: {
            edges: [
              {
                node: {
                  id: "p1",
                  text: "Scheduled",
                  dueAt: "2026-11-02T13:00:00.000Z", // 14:00 Europe/Madrid
                  channelId: "chan-x",
                  status: "scheduled",
                },
              },
            ],
          },
        },
      }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  };

  const slots = await fetchNextChannelSlotsForAccount("valid-key", ["X", "Bluesky"], {}, mockFetch, now);
  // Monday Nov 2 14:00 is occupied, so next Monday Nov 9 14:00 is chosen for X
  assert.deepEqual(slots.X, { date: "2026-11-09", time: "14:00" });
  // Bluesky has no channel in Buffer response so falls back to default (13:14)
  assert.deepEqual(slots.Bluesky, { date: "2026-11-01", time: "13:14" });

  const fallbackSlots = await fetchNextChannelSlotsForAccount(null, ["X"], {}, mockFetch, now);
  assert.deepEqual(fallbackSlots.X, { date: "2026-11-01", time: "14:14" });
});
