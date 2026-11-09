import type { PostLanguage } from "./language";
import type { SocialNetwork } from "./social-validation";
import type { ApprovedStyleExample } from "./groq";

export const DEFAULT_STYLE_EXAMPLES_PER_SEGMENT = 3;
export const SUPPORTED_NETWORKS: readonly SocialNetwork[] = ["LinkedIn", "X", "Bluesky"];
export const SUPPORTED_LANGUAGES: readonly PostLanguage[] = ["en", "es", "ca"];

export type StyleExampleSegment = {
  accountId: string;
  network: SocialNetwork;
  language: PostLanguage;
};

export interface StyleExampleRow {
  content: string;
  account_id: string;
  network: string;
  language: string;
  created_at?: string;
}

export type RawStyleExampleInput = {
  content?: string;
  text?: string;
  account_id?: string;
  accountId?: string;
  network: string;
  language: string;
  created_at?: string | Date | number;
  createdAt?: string | Date | number;
};

export type StyleExamplesQueryOptions = {
  ownerId: string;
  accountIds?: readonly string[];
  segments?: readonly StyleExampleSegment[];
  languages?: readonly PostLanguage[];
  networks?: readonly SocialNetwork[];
  limitPerSegment?: number;
  errorMessage?: string;
};

export type StyleExampleQueryContext = {
  language?: PostLanguage;
  networks?: readonly SocialNetwork[];
  segments?: readonly StyleExampleSegment[];
  limitPerSegment?: number;
};

type SupabaseQueryChain = {
  select(columns: string): SupabaseQueryChain;
  eq(column: string, value: string): SupabaseQueryChain;
  order(column: string, options: { ascending: boolean }): SupabaseQueryChain;
  limit(count: number): PromiseLike<{
    data: StyleExampleRow[] | null;
    error: { message: string } | null;
  }>;
};

export type SupabaseStyleExamplesClient = {
  from(table: string): SupabaseQueryChain;
};

/** Build unique segments from accounts and languages. */
export function buildStyleExampleSegments(
  accounts: readonly { id?: string; networks?: readonly string[] }[],
  languages: readonly PostLanguage[] = SUPPORTED_LANGUAGES,
): StyleExampleSegment[] {
  const segments: StyleExampleSegment[] = [];
  const seen = new Set<string>();

  for (const account of accounts) {
    if (!account.id) continue;
    const networks = (account.networks ?? SUPPORTED_NETWORKS).filter((network): network is SocialNetwork =>
      SUPPORTED_NETWORKS.includes(network as SocialNetwork),
    );
    for (const network of networks) {
      for (const language of languages) {
        if (!SUPPORTED_LANGUAGES.includes(language)) continue;
        const key = `${account.id}:${network}:${language}`;
        if (!seen.has(key)) {
          seen.add(key);
          segments.push({ accountId: account.id, network, language });
        }
      }
    }
  }

  return segments;
}

/** Normalize raw database or in-memory row to ApprovedStyleExample if valid. */
export function toApprovedStyleExample(
  row: RawStyleExampleInput,
): (ApprovedStyleExample & { createdAt?: string | Date | number }) | null {
  const accountId = row.accountId ?? row.account_id;
  const text = row.text ?? row.content;
  if (!accountId || typeof text !== "string") return null;
  if (!SUPPORTED_NETWORKS.includes(row.network as SocialNetwork)) return null;
  if (!SUPPORTED_LANGUAGES.includes(row.language as PostLanguage)) return null;
  return {
    accountId,
    network: row.network as SocialNetwork,
    language: row.language as PostLanguage,
    text,
    ...(row.createdAt !== undefined || row.created_at !== undefined
      ? { createdAt: row.createdAt ?? row.created_at }
      : {}),
  };
}

/**
 * Segment examples by (accountId, network, language) and apply quota per segment.
 * Ensures high activity in one segment does not displace valid examples in another.
 */
export function segmentStyleExamples<T extends RawStyleExampleInput>(
  examples: readonly T[],
  limitPerSegment = DEFAULT_STYLE_EXAMPLES_PER_SEGMENT,
): ApprovedStyleExample[] {
  if (limitPerSegment <= 0) return [];
  const groups = new Map<string, Array<ApprovedStyleExample & { createdAt?: string | Date | number }>>();

  for (const item of examples) {
    const example = toApprovedStyleExample(item);
    if (!example) continue;
    const key = `${example.accountId}:${example.network}:${example.language}`;
    const list = groups.get(key);
    if (list) {
      list.push(example);
    } else {
      groups.set(key, [example]);
    }
  }

  const result: ApprovedStyleExample[] = [];
  for (const list of groups.values()) {
    if (list.length > 1 && list.some((item) => item.createdAt !== undefined)) {
      list.sort((a, b) => {
        const timeA = a.createdAt !== undefined ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt !== undefined ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
      });
    }
    for (const item of list.slice(0, limitPerSegment)) {
      result.push({
        accountId: item.accountId,
        network: item.network,
        language: item.language,
        text: item.text,
      });
    }
  }
  return result;
}

function resolveTargetSegments(options: StyleExamplesQueryOptions): StyleExampleSegment[] {
  let segments: StyleExampleSegment[];
  if (options.segments && options.segments.length > 0) {
    const allowed = options.accountIds ? new Set(options.accountIds) : null;
    segments = options.segments.filter((s) =>
      (!allowed || allowed.has(s.accountId)) &&
      SUPPORTED_NETWORKS.includes(s.network) &&
      SUPPORTED_LANGUAGES.includes(s.language),
    );
  } else if (options.accountIds && options.accountIds.length > 0) {
    segments = buildStyleExampleSegments(
      options.accountIds.map((id) => ({
        id,
        networks: options.networks ?? SUPPORTED_NETWORKS,
      })),
      options.languages ?? SUPPORTED_LANGUAGES,
    );
  } else {
    return [];
  }

  const unique: StyleExampleSegment[] = [];
  const seen = new Set<string>();
  for (const s of segments) {
    const key = `${s.accountId}:${s.network}:${s.language}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(s);
    }
  }
  return unique;
}

async function fetchSegmentExamples(
  client: SupabaseStyleExamplesClient,
  ownerId: string,
  segment: StyleExampleSegment,
  limit: number,
  errorMessage?: string,
): Promise<ApprovedStyleExample[]> {
  const { data, error } = await client
    .from("style_examples")
    .select("content,account_id,network,language")
    .eq("owner_id", ownerId)
    .eq("account_id", segment.accountId)
    .eq("network", segment.network)
    .eq("language", segment.language)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(errorMessage ?? "Unable to read approved style examples");
  }

  return (data ?? []).flatMap((row) => {
    const example = toApprovedStyleExample(row);
    return example ? [{
      accountId: example.accountId,
      network: example.network,
      language: example.language,
      text: example.text,
    }] : [];
  });
}

/**
 * Retrieve approved style examples filtered by segment before applying per-segment limits.
 * Uses index on (owner_id, account_id, network, language, created_at desc).
 */
export async function fetchApprovedStyleExamples(
  supabase: unknown,
  options: StyleExamplesQueryOptions,
): Promise<ApprovedStyleExample[]> {
  const limit = options.limitPerSegment ?? DEFAULT_STYLE_EXAMPLES_PER_SEGMENT;
  if (limit <= 0) return [];

  const segments = resolveTargetSegments(options);
  if (segments.length === 0) return [];

  const client = supabase as SupabaseStyleExamplesClient;
  const queries = segments.map((seg) =>
    fetchSegmentExamples(client, options.ownerId, seg, limit, options.errorMessage),
  );
  const results = await Promise.all(queries);
  return results.flat();
}
