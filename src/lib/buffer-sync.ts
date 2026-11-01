import { detectTitleLanguage, type PostLanguage } from "./language";
import { formatMadridDateTime } from "./madrid-time";
import type { SocialNetwork } from "./social-validation";

export interface BufferScheduledPostItem {
  id: string;
  bufferPostId: string;
  accountName: string;
  accountId: string;
  network: SocialNetwork;
  text: string;
  dueAt: string;
}

export interface BufferDiscoveredChannel {
  network: SocialNetwork;
  channelId: string;
  channelName: string;
}

export interface BufferAccountSyncResult {
  posts: BufferScheduledPostItem[];
  channels: BufferDiscoveredChannel[];
}

export interface BufferSyncAccount {
  id: string;
  name: string;
  apiKey: string | null;
  bufferChannels: Partial<Record<SocialNetwork, string>>;
}

export interface BufferPostView {
  id: string;
  eventId: string;
  date: string;
  time: string;
  account: string;
  accountId: string;
  network: SocialNetwork;
  text: string;
  status: "scheduled";
  bufferPostId: string;
  language: PostLanguage;
}

const BUFFER_API_URL = "https://api.buffer.com";

export function mapServiceToNetwork(service: string): SocialNetwork | null {
  const normalized = service.toLowerCase();
  if (normalized === "twitter" || normalized === "x") return "X";
  if (normalized === "linkedin") return "LinkedIn";
  if (normalized === "bluesky") return "Bluesky";
  return null;
}

async function queryBufferGraphql<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown> | undefined,
  fetchImpl: typeof fetch,
): Promise<T | null> {
  try {
    const response = await fetchImpl(BUFFER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: T; errors?: unknown[] };
    return body.data ?? null;
  } catch {
    return null;
  }
}

interface AccountOrgData {
  account?: {
    organizations?: Array<{ id: string; name: string }>;
  };
}

interface ChannelsData {
  channels?: Array<{ id: string; name: string; service: string }>;
}

interface PostsData {
  posts?: {
    edges?: Array<{
      node: {
        id: string;
        text: string;
        dueAt: string;
        channelId: string;
        status: string;
      };
    }>;
  };
}

export async function fetchScheduledPostsForAccount(
  apiKey: string,
  accountName: string,
  accountId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BufferAccountSyncResult> {
  if (!apiKey?.trim()) return { posts: [], channels: [] };

  const orgData = await queryBufferGraphql<AccountOrgData>(
    apiKey,
    "query { account { organizations { id name } } }",
    undefined,
    fetchImpl,
  );
  const orgId = orgData?.account?.organizations?.[0]?.id;
  if (!orgId) return { posts: [], channels: [] };

  const channelsData = await queryBufferGraphql<ChannelsData>(
    apiKey,
    `query GetChannels($input: ChannelsInput!) {
      channels(input: $input) { id name service }
    }`,
    { input: { organizationId: orgId } },
    fetchImpl,
  );
  const rawChannels = channelsData?.channels ?? [];
  const channels: BufferDiscoveredChannel[] = [];
  const channelNetworkMap = new Map<string, SocialNetwork>();

  for (const c of rawChannels) {
    const network = mapServiceToNetwork(c.service);
    if (!network) continue;
    channelNetworkMap.set(c.id, network);
    channels.push({ network, channelId: c.id, channelName: c.name });
  }

  const postsData = await queryBufferGraphql<PostsData>(
    apiKey,
    `query GetScheduledPosts($input: PostsInput!) {
      posts(first: 50, input: $input) {
        edges {
          node {
            id
            text
            dueAt
            channelId
            status
          }
        }
      }
    }`,
    { input: { organizationId: orgId, filter: { status: ["scheduled"] } } },
    fetchImpl,
  );

  const edges = postsData?.posts?.edges ?? [];
  const posts: BufferScheduledPostItem[] = [];

  for (const edge of edges) {
    const node = edge.node;
    if (!node?.id || !node.text || !node.dueAt) continue;
    const network = channelNetworkMap.get(node.channelId);
    if (!network) continue;
    posts.push({
      id: node.id,
      bufferPostId: node.id,
      accountName,
      accountId,
      network,
      text: node.text,
      dueAt: node.dueAt,
    });
  }

  return { posts, channels };
}

export async function syncBufferScheduledPosts(
  accounts: BufferSyncAccount[],
  events: Array<{ id: string; title: string }>,
  existingBufferPostIds: Set<string>,
  onChannelDiscovered?: (accountId: string, network: SocialNetwork, channelId: string) => Promise<void>,
  fetchImpl: typeof fetch = fetch,
): Promise<BufferPostView[]> {
  const resultPosts: BufferPostView[] = [];

  for (const account of accounts) {
    if (!account.apiKey?.trim()) continue;

    try {
      const syncResult = await fetchScheduledPostsForAccount(
        account.apiKey,
        account.name,
        account.id,
        fetchImpl,
      );

      for (const channel of syncResult.channels) {
        if (!account.bufferChannels[channel.network]) {
          account.bufferChannels[channel.network] = channel.channelId;
          if (onChannelDiscovered) {
            try {
              await onChannelDiscovered(account.id, channel.network, channel.channelId);
            } catch {
              // Ignore failure to persist discovered channel
            }
          }
        }
      }

      for (const p of syncResult.posts) {
        if (existingBufferPostIds.has(p.bufferPostId)) continue;
        existingBufferPostIds.add(p.bufferPostId);

        const scheduled = formatMadridDateTime(p.dueAt);
        const matchingEvent = events.find((e) =>
          e.title && p.text.toLowerCase().includes(e.title.toLowerCase()),
        );

        resultPosts.push({
          id: `buffer-${p.id}`,
          eventId: matchingEvent?.id ?? "",
          date: scheduled.date,
          time: scheduled.time,
          account: p.accountName,
          accountId: p.accountId,
          network: p.network,
          text: p.text,
          status: "scheduled",
          bufferPostId: p.bufferPostId,
          language: detectTitleLanguage(p.text),
        });
      }
    } catch {
      // Continue to next account if one fails
    }
  }

  return resultPosts;
}
