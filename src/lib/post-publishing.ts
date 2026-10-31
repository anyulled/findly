import {
  BufferApiError,
  BufferClient,
  BufferUncertainResultError,
  type ScheduleBufferPostResult,
} from "@/lib/buffer";
import type { SocialNetwork } from "@/lib/social-validation";
import { validatePost } from "@/lib/social-validation";
import { bufferCredentialForAccount } from "@/lib/buffer-account-credentials";

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

export interface PostPublishingRepository {
  claim(postId: string): Promise<PostToSchedule | null>;
  accountName(accountId: string): Promise<string | null>;
  bufferChannelId(accountId: string, network: SocialNetwork): Promise<string | null>;
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
  constructor(private readonly supabase: SupabasePublisherClient, private readonly ownerId: string) {}

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

export async function schedulePostWithBuffer(
  postId: string,
  repository: PostPublishingRepository,
  createClient: (accountId: string) => Promise<BufferClient> | BufferClient,
): Promise<PostPublishingOutcome> {
  const post = await repository.claim(postId);
  if (!post) return { kind: "not_claimed" };

  const network = networkFromDatabase(post.network);
  if (!network) {
    const message = "La red de la publicación no está admitida por Buffer.";
    await repository.markFailure(post.id, post.attempt_id, message, false);
    return { kind: "failed", message };
  }
  const validation = validatePost(network, post.content);
  if (!validation.valid) {
    await repository.markFailure(post.id, post.attempt_id, validation.message, false);
    return { kind: "failed", message: validation.message };
  }

  let channelId: string | null;
  try {
    channelId = await repository.bufferChannelId(post.account_id, network);
  } catch (error) {
    const message = errorMessage(error);
    await repository.markFailure(post.id, post.attempt_id, message, false);
    return { kind: "failed", message };
  }
  if (!channelId) {
    const message = `Configura el ID del canal de Buffer para ${network} en esta cuenta.`;
    await repository.markFailure(post.id, post.attempt_id, message, false);
    return { kind: "failed", message };
  }

  const dueAt = new Date(post.due_at);
  if (!Number.isFinite(dueAt.getTime())) {
    const message = "La fecha de publicación guardada no es válida.";
    await repository.markFailure(post.id, post.attempt_id, message, false);
    return { kind: "failed", message };
  }
  if (dueAt.getTime() <= Date.now()) {
    const message = "La hora programada en Europe/Madrid ya pasó; esta publicación no se enviará.";
    await repository.markFailure(post.id, post.attempt_id, message, false);
    return { kind: "failed", message };
  }

  let client: BufferClient;
  try {
    client = await createClient(post.account_id);
  } catch (error) {
    const message = errorMessage(error);
    await repository.markFailure(post.id, post.attempt_id, message, false);
    return { kind: "failed", message };
  }

  let result: ScheduleBufferPostResult;
  try {
    result = await client.schedulePost({
      channelId,
      text: post.content,
      dueAt: dueAt.toISOString(),
    });
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

export async function schedulePostWithSupabase(
  postId: string,
  supabase: unknown,
  ownerId: string,
  fetchImpl?: typeof fetch,
): Promise<PostPublishingOutcome> {
  const repository = new SupabasePostPublishingRepository(supabase as SupabasePublisherClient, ownerId);
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
