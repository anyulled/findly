import {
  BufferApiError,
  BufferClient,
  BufferUncertainResultError,
  type ScheduleBufferPostInput,
  type ScheduleBufferPostResult,
} from "@/lib/buffer";
import type { SocialNetwork } from "@/lib/social-validation";
import { validatePost } from "@/lib/social-validation";
import { bufferCredentialForAccount } from "@/lib/buffer-account-credentials";
import { isSubstackUrl, unpackLocationAndImage } from "@/lib/substack";
import { fetchOpenGraphImage } from "@/lib/opengraph";

type DatabaseError = { message: string };
type DatabaseResult<T> = { data: T | null; error: DatabaseError | null };

export interface PostToSchedule {
  id: string;
  attempt_id: string;
  account_id: string;
  network: string;
  due_at: string;
  content: string;
}

export interface PostContext {
  eventUrl?: string | null;
  imageUrl?: string | null;
}

export interface PostPublishingRepository {
  claim(postId: string): Promise<PostToSchedule | null>;
  accountName(accountId: string): Promise<string | null>;
  bufferChannelId(accountId: string, network: SocialNetwork): Promise<string | null>;
  postContext?(postId: string): Promise<PostContext | null>;
  markScheduled(postId: string, attemptId: string, bufferPostId: string): Promise<void>;
  markFailure(postId: string, attemptId: string, message: string, needsReconciliation: boolean): Promise<void>;
}

export type PostPublishingOutcome =
  | { kind: "scheduled"; bufferPostId: string }
  | { kind: "failed"; message: string }
  | { kind: "needs_reconciliation"; message: string }
  | { kind: "not_claimed" };

type SupabasePublisherClient = {
  from(table: "accounts"): {
    select(columns: "name"): {
      eq(column: string, value: string): {
        eq(column: string, value: string): { maybeSingle(): PromiseLike<DatabaseResult<{ name: string }>> };
      };
    };
  };
  from(table: "account_buffer_channels"): {
    select(columns: "buffer_channel_id"): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          eq(column: string, value: string): { maybeSingle(): PromiseLike<DatabaseResult<{ buffer_channel_id: string }>> };
        };
      };
    };
  };
  from(table: "posts"): {
    select(columns: "event_id"): {
      eq(column: string, value: string): {
        eq(column: string, value: string): { maybeSingle(): PromiseLike<DatabaseResult<{ event_id: string | null }>> };
      };
    };
  };
  from(table: "events"): {
    select(columns: "event_url,location"): {
      eq(column: string, value: string): {
        eq(column: string, value: string): { maybeSingle(): PromiseLike<DatabaseResult<{ event_url: string | null; location: string }>> };
      };
    };
  };
  rpc(name: string, args: Record<string, unknown>): {
    maybeSingle(): PromiseLike<DatabaseResult<PostToSchedule>>;
    then<TResult1 = DatabaseResult<null>, TResult2 = never>(
      onfulfilled?: ((value: DatabaseResult<null>) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2>;
  };
};

function networkFromDatabase(value: string): SocialNetwork | null {
  return value === "LinkedIn" || value === "X" || value === "Bluesky" ? value : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return "No se pudo confirmar el resultado de Buffer.";
}

function isUncertain(error: unknown): boolean {
  return error instanceof BufferUncertainResultError ||
    (error instanceof BufferApiError && error.outcome === "unknown");
}

export class SupabasePostPublishingRepository implements PostPublishingRepository {
  constructor(
    private readonly supabase: SupabasePublisherClient,
    private readonly ownerId: string,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async claim(postId: string): Promise<PostToSchedule | null> {
    const { data, error } = await this.supabase.rpc("claim_post_for_scheduling", {
      p_post_id: postId,
      p_owner_id: this.ownerId,
    }).maybeSingle();
    if (error) throw new Error(`No se pudo reservar la publicación: ${error.message}`);
    return data;
  }

  async bufferChannelId(accountId: string, network: SocialNetwork): Promise<string | null> {
    const { data, error } = await this.supabase.from("account_buffer_channels")
      .select("buffer_channel_id")
      .eq("owner_id", this.ownerId)
      .eq("account_id", accountId)
      .eq("network", network)
      .maybeSingle();
    if (error) throw new Error(`No se pudo cargar el canal de Buffer: ${error.message}`);
    return data?.buffer_channel_id ?? null;
  }

  async accountName(accountId: string): Promise<string | null> {
    const { data, error } = await this.supabase.from("accounts").select("name")
      .eq("owner_id", this.ownerId).eq("id", accountId).maybeSingle();
    if (error) throw new Error(`No se pudo cargar la cuenta de Buffer: ${error.message}`);
    return data?.name ?? null;
  }

  async postContext(postId: string): Promise<PostContext | null> {
    const postQuery = (this.supabase as Partial<SupabasePublisherClient>).from?.("posts");
    if (!postQuery) return null;
    const { data: postRow } = await postQuery.select("event_id")
      .eq("owner_id", this.ownerId).eq("id", postId).maybeSingle();
    if (!postRow?.event_id) return null;
    const eventQuery = (this.supabase as Partial<SupabasePublisherClient>).from?.("events");
    if (!eventQuery) return null;
    const { data: eventRow } = await eventQuery.select("event_url,location")
      .eq("owner_id", this.ownerId).eq("id", postRow.event_id).maybeSingle();
    if (!eventRow) return null;
    const unpacked = unpackLocationAndImage(eventRow.location);
    const resolvedImage = unpacked.imageUrl ?? (await fetchOpenGraphImage(eventRow.event_url, this.fetchImpl));
    return {
      eventUrl: eventRow.event_url,
      imageUrl: resolvedImage ?? null,
    };
  }

  async markScheduled(postId: string, attemptId: string, bufferPostId: string): Promise<void> {
    const { error } = await this.supabase.rpc("mark_post_scheduled", {
      p_post_id: postId,
      p_buffer_post_id: bufferPostId,
      p_attempt_id: attemptId,
      p_owner_id: this.ownerId,
    });
    if (error) throw new Error(`Buffer aceptó la publicación, pero no se pudo guardar su ID: ${error.message}`);
  }

  async markFailure(postId: string, attemptId: string, message: string, needsReconciliation: boolean): Promise<void> {
    const { error } = await this.supabase.rpc("mark_post_scheduling_failure", {
      p_post_id: postId,
      p_error: message,
      p_attempt_id: attemptId,
      p_needs_reconciliation: needsReconciliation,
      p_owner_id: this.ownerId,
    });
    if (error) throw new Error(`No se pudo guardar el resultado de Buffer: ${error.message}`);
  }
}

function buildSchedulePayload(
  post: PostToSchedule,
  channelId: string,
  context: PostContext | null,
): { ok: true; input: ScheduleBufferPostInput } | { ok: false; message: string } {
  const useQueueSlot = isSubstackUrl(context?.eventUrl);
  const dueAt = new Date(post.due_at);
  if (!useQueueSlot) {
    if (!Number.isFinite(dueAt.getTime())) {
      return { ok: false, message: "La fecha de publicación guardada no es válida." };
    }
    if (dueAt.getTime() <= Date.now()) {
      return { ok: false, message: "La hora programada en Europe/Madrid ya pasó; esta publicación no se enviará." };
    }
  }
  return {
    ok: true,
    input: {
      channelId,
      text: post.content,
      ...(useQueueSlot ? { mode: "addToQueue" as const } : { dueAt: dueAt.toISOString() }),
      ...(context?.imageUrl ? { imageUrl: context.imageUrl } : {}),
    },
  };
}

async function validatePostAndChannel(
  post: PostToSchedule,
  repository: PostPublishingRepository,
): Promise<{ channelId: string; network: SocialNetwork } | { failure: string }> {
  const network = networkFromDatabase(post.network);
  if (!network) return { failure: "La red de la publicación no está admitida por Buffer." };
  const validation = validatePost(network, post.content);
  if (!validation.valid) return { failure: validation.message };
  try {
    const channelId = await repository.bufferChannelId(post.account_id, network);
    if (!channelId) return { failure: `Configura el ID del canal de Buffer para ${network} en esta cuenta.` };
    return { channelId, network };
  } catch (error) {
    return { failure: errorMessage(error) };
  }
}

async function dispatchClaimedPostToBuffer(
  client: BufferClient,
  post: PostToSchedule,
  payload: { ok: true; input: ScheduleBufferPostInput },
  repository: PostPublishingRepository,
): Promise<PostPublishingOutcome> {
  let result: ScheduleBufferPostResult;
  try {
    result = await client.schedulePost(payload.input);
  } catch (error) {
    const message = errorMessage(error);
    const needsReconciliation = isUncertain(error);
    await repository.markFailure(post.id, post.attempt_id, message, needsReconciliation);
    return { kind: needsReconciliation ? "needs_reconciliation" : "failed", message };
  }
  if (result.kind === "rejected") {
    await repository.markFailure(post.id, post.attempt_id, result.error.message, false);
    return { kind: "failed", message: result.error.message };
  }

  try {
    await repository.markScheduled(post.id, post.attempt_id, result.post.id);
  } catch (error) {
    const message = `Buffer confirmó el envío, pero Findly no pudo guardar su ID: ${errorMessage(error)}`;
    await repository.markFailure(post.id, post.attempt_id, message, true);
    return { kind: "needs_reconciliation", message };
  }
  return { kind: "scheduled", bufferPostId: result.post.id };
}

export async function schedulePostWithBuffer(
  postId: string,
  repository: PostPublishingRepository,
  createClient: (accountId: string) => Promise<BufferClient> | BufferClient,
): Promise<PostPublishingOutcome> {
  const post = await repository.claim(postId);
  if (!post) return { kind: "not_claimed" };

  const check = await validatePostAndChannel(post, repository);
  if ("failure" in check) {
    await repository.markFailure(post.id, post.attempt_id, check.failure, false);
    return { kind: "failed", message: check.failure };
  }

  const context = await repository.postContext?.(post.id).catch(() => null) ?? null;
  const payload = buildSchedulePayload(post, check.channelId, context);
  if (!payload.ok) {
    await repository.markFailure(post.id, post.attempt_id, payload.message, false);
    return { kind: "failed", message: payload.message };
  }

  let client: BufferClient;
  try {
    client = await createClient(post.account_id);
  } catch (error) {
    const message = errorMessage(error);
    await repository.markFailure(post.id, post.attempt_id, message, false);
    return { kind: "failed", message };
  }

  return dispatchClaimedPostToBuffer(client, post, payload, repository);
}

export async function schedulePostWithSupabase(
  postId: string,
  supabase: unknown,
  ownerId: string,
  fetchImpl?: typeof fetch,
): Promise<PostPublishingOutcome> {
  const repository = new SupabasePostPublishingRepository(supabase as SupabasePublisherClient, ownerId, fetchImpl);
  return schedulePostWithBuffer(postId, repository, async (accountId) => {
    const name = await repository.accountName(accountId);
    if (!name) throw new Error("No se encontró la cuenta asociada a la publicación.");
    const credential = bufferCredentialForAccount(name);
    if (!credential.apiKey) throw new Error(`Falta configurar ${credential.environmentVariable ?? "la API key de Buffer"} para ${name}.`);
    return new BufferClient({ apiKey: credential.apiKey, fetchImpl });
  });
}

export async function approveAndSchedulePost(
  postId: string,
  content: string,
  supabase: unknown,
  ownerId: string,
  fetchImpl?: typeof fetch,
): Promise<PostPublishingOutcome> {
  const database = supabase as SupabasePublisherClient;
  const { error } = await database.rpc("approve_post", {
    p_post_id: postId,
    p_content: content,
  });
  if (error) throw new Error(`No se pudo aprobar la publicación: ${error.message}`);
  return schedulePostWithSupabase(postId, database, ownerId, fetchImpl);
}
