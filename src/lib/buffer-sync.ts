import { detectTitleLanguage, type PostLanguage } from "./language";
import { formatMadridDateTime } from "./madrid-time";
import type { SocialNetwork } from "./social-validation";
import { logger } from "./logger";

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

export interface BufferPostingScheduleDay {
  day: string;
  times: string[];
  paused: boolean;
}

export interface BufferSlot {
  date: string;
  time: string;
}

const WEEKDAY_CODES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function computeNextSlotFromSchedule(
  network: SocialNetwork,
  schedule: BufferPostingScheduleDay[] | undefined,
  occupiedSlots: Set<string>,
  now: Date = new Date(),
): BufferSlot {
  const defaultTime = network === "X" ? "14:14" : "13:14";
  const nowMadrid = formatMadridDateTime(now);
  const [startYear, startMonth, startDay] = nowMadrid.date.split("-").map(Number);

  for (let offset = 0; offset <= 30; offset += 1) {
    const candidate = new Date(Date.UTC(startYear, startMonth - 1, startDay + offset, 12, 0, 0));
    const date = candidate.toISOString().slice(0, 10);
    const dayCode = WEEKDAY_CODES[candidate.getUTCDay()];
    const dayEntry = schedule && schedule.length > 0
      ? schedule.find((item) => item.day.toLowerCase().slice(0, 3) === dayCode)
      : { day: dayCode, times: [defaultTime], paused: false };
    if (!dayEntry || dayEntry.paused || dayEntry.times.length === 0) continue;

    for (const rawTime of dayEntry.times) {
      const time = rawTime.slice(0, 5);
      if (offset === 0 && time <= nowMadrid.time) continue;
      const key = `${date}T${time}`;
      if (!occupiedSlots.has(key)) {
        occupiedSlots.add(key);
        return { date, time };
      }
    }
  }

  const fallback = new Date(Date.UTC(startYear, startMonth - 1, startDay + 1, 12, 0, 0)).toISOString().slice(0, 10);
  return { date: fallback, time: defaultTime };
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
  channels?: Array<{
    id: string;
    name: string;
    service: string;
    postingSchedule?: BufferPostingScheduleDay[];
  }>;
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

const BUFFER_SYNC_CACHE_TTL_MS = 60_000;
const bufferAccountSyncCache = new Map<string, { expiresAt: number; result: BufferAccountSyncResult }>();

export function invalidateBufferSyncCache(): void {
  bufferAccountSyncCache.clear();
}

function readBufferSyncCache(accountId: string, apiKey: string, useCache: boolean): BufferAccountSyncResult | undefined {
  if (!useCache) return undefined;
  const cached = bufferAccountSyncCache.get(`${accountId}:${apiKey.trim()}`);
  return cached && cached.expiresAt > Date.now() ? cached.result : undefined;
}

function writeBufferSyncCache(accountId: string, apiKey: string, result: BufferAccountSyncResult, useCache: boolean): void {
  if (!useCache) return;
  bufferAccountSyncCache.set(`${accountId}:${apiKey.trim()}`, {
    expiresAt: Date.now() + BUFFER_SYNC_CACHE_TTL_MS,
    result,
  });
}

export async function fetchScheduledPostsForAccount(
  apiKey: string,
  accountName: string,
  accountId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BufferAccountSyncResult> {
  if (!apiKey?.trim()) return { posts: [], channels: [] };

  const useCache = fetchImpl === fetch;
  const cached = readBufferSyncCache(accountId, apiKey, useCache);
  if (cached) return cached;

  const orgData = await queryBufferGraphql<AccountOrgData>(
    apiKey,
    "query { account { organizations { id name } } }",
    undefined,
    fetchImpl,
  );
  const orgId = orgData?.account?.organizations?.[0]?.id;
  if (!orgId) return { posts: [], channels: [] };

  const [channelsData, postsData] = await Promise.all([
    queryBufferGraphql<ChannelsData>(
      apiKey,
      `query GetChannels($input: ChannelsInput!) {
      channels(input: $input) { id name service }
    }`,
      { input: { organizationId: orgId } },
      fetchImpl,
    ),
    queryBufferGraphql<PostsData>(
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
    ),
  ]);

  const rawChannels = channelsData?.channels ?? [];
  const channels: BufferDiscoveredChannel[] = [];
  const channelNetworkMap = new Map<string, SocialNetwork>();

  for (const c of rawChannels) {
    const network = mapServiceToNetwork(c.service);
    if (!network) continue;
    channelNetworkMap.set(c.id, network);
    channels.push({ network, channelId: c.id, channelName: c.name });
  }

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

  const result = { posts, channels };
  writeBufferSyncCache(accountId, apiKey, result, useCache);
  return result;
}

export async function syncBufferScheduledPosts(
  accounts: BufferSyncAccount[],
  events: Array<{ id: string; title: string }>,
  existingBufferPostIds: Set<string>,
  onChannelDiscovered?: (accountId: string, network: SocialNetwork, channelId: string) => Promise<void>,
  fetchImpl: typeof fetch = fetch,
): Promise<BufferPostView[]> {
  const resultPosts: BufferPostView[] = [];
  const syncedAccounts = await Promise.all(
    accounts.map(async (account) => {
      if (!account.apiKey?.trim()) return null;
      try {
        const syncResult = await fetchScheduledPostsForAccount(
          account.apiKey,
          account.name,
          account.id,
          fetchImpl,
        );
        return { account, syncResult };
      } catch (error) {
        logger.warn("Failed to fetch scheduled posts for account during Buffer sync", { accountId: account.id, accountName: account.name }, error);
        return null;
      }
    }),
  );

  for (const entry of syncedAccounts) {
    if (!entry) continue;
    const { account, syncResult } = entry;

    for (const channel of syncResult.channels) {
      if (!account.bufferChannels[channel.network]) {
        account.bufferChannels[channel.network] = channel.channelId;
        if (onChannelDiscovered) {
          try {
            await onChannelDiscovered(account.id, channel.network, channel.channelId);
          } catch (error) {
            logger.warn("Failed to persist discovered Buffer channel for account", { accountId: account.id, network: channel.network, channelId: channel.channelId }, error);
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
  }

  return resultPosts;
}

export async function fetchNextChannelSlotsForAccount(
  apiKey: string | null | undefined,
  networks: SocialNetwork[],
  existingOccupiedByNetwork: Partial<Record<SocialNetwork, Set<string>>> = {},
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<Record<SocialNetwork, BufferSlot>> {
  const schedulesByNetwork = new Map<SocialNetwork, BufferPostingScheduleDay[]>();
  const occupiedByNetwork: Record<SocialNetwork, Set<string>> = {
    LinkedIn: new Set(existingOccupiedByNetwork.LinkedIn ?? []),
    X: new Set(existingOccupiedByNetwork.X ?? []),
    Bluesky: new Set(existingOccupiedByNetwork.Bluesky ?? []),
  };

  if (apiKey?.trim()) {
    const orgData = await queryBufferGraphql<AccountOrgData>(
      apiKey,
      "query { account { organizations { id name } } }",
      undefined,
      fetchImpl,
    );
    const orgId = orgData?.account?.organizations?.[0]?.id;
    if (orgId) {
      const channelsData = await queryBufferGraphql<ChannelsData>(
        apiKey,
        `query GetChannelsWithSchedule($input: ChannelsInput!) {
          channels(input: $input) {
            id
            name
            service
            postingSchedule { day times paused }
          }
        }`,
        { input: { organizationId: orgId } },
        fetchImpl,
      );
      const channelNetworkMap = new Map<string, SocialNetwork>();
      for (const chan of channelsData?.channels ?? []) {
        const net = mapServiceToNetwork(chan.service);
        if (!net) continue;
        channelNetworkMap.set(chan.id, net);
        if (chan.postingSchedule) schedulesByNetwork.set(net, chan.postingSchedule);
      }

      const postsData = await queryBufferGraphql<PostsData>(
        apiKey,
        `query GetScheduledPosts($input: PostsInput!) {
          posts(first: 50, input: $input) {
            edges { node { id text dueAt channelId status } }
          }
        }`,
        { input: { organizationId: orgId, filter: { status: ["scheduled"] } } },
        fetchImpl,
      );
      for (const edge of postsData?.posts?.edges ?? []) {
        const node = edge.node;
        const net = node?.channelId ? channelNetworkMap.get(node.channelId) : undefined;
        if (!net || !node?.dueAt) continue;
        const dt = formatMadridDateTime(node.dueAt);
        occupiedByNetwork[net].add(`${dt.date}T${dt.time}`);
      }
    }
  }

  const result = {} as Record<SocialNetwork, BufferSlot>;
  for (const network of networks) {
    result[network] = computeNextSlotFromSchedule(
      network,
      schedulesByNetwork.get(network),
      occupiedByNetwork[network],
      now,
    );
  }
  return result;
}
