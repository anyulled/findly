import { schedulePostWithSupabase, type PostPublishingOutcome } from "./post-publishing";

export type ApprovedDispatchResult = {
  selected: number;
  scheduled: number;
  failed: number;
  needsReconciliation: number;
  notClaimed: number;
  errors: number;
  deferred: number;
};

// A Buffer request can take up to 20 seconds. Stop starting further requests
// after 10 seconds spent dispatching, without aborting an active send.
export const RECOVERY_BUDGET_MS = 10_000;
export type DispatchBudget = { remainingMs: number };

export function hasDispatchFailures(...results: ApprovedDispatchResult[]): boolean {
  return results.some((result) => result.failed > 0 || result.needsReconciliation > 0 || result.errors > 0);
}

/** Record each event batch, including failures before a batch can be listed. */
export async function recordDispatchBatch(
  summary: ApprovedDispatchResult,
  run: () => Promise<ApprovedDispatchResult>,
): Promise<void> {
  try {
    const result = await run();
    for (const key of Object.keys(summary) as (keyof ApprovedDispatchResult)[]) summary[key] += result[key];
  } catch (error) {
    summary.errors += 1;
    throw error;
  }
}

/** Resume durable approved intents. Each scheduler atomically claims its post. */
export async function dispatchApprovedPosts(
  listApproved: () => Promise<string[]>,
  schedule: (postId: string) => Promise<PostPublishingOutcome>,
  options: { now?: () => number; budget?: DispatchBudget } = {},
): Promise<ApprovedDispatchResult> {
  const now = options.now ?? Date.now;
  const budget = options.budget ?? { remainingMs: RECOVERY_BUDGET_MS };
  const postIds = await listApproved();
  const result: ApprovedDispatchResult = { selected: postIds.length, scheduled: 0, failed: 0, needsReconciliation: 0, notClaimed: 0, errors: 0, deferred: 0 };
  for (let index = 0; index < postIds.length; index += 1) {
    if (budget.remainingMs <= 0) {
      result.deferred = postIds.length - index;
      break;
    }
    const postId = postIds[index];
    const started = now();
    try {
      const outcome = await schedule(postId);
      if (outcome.kind === "scheduled") result.scheduled += 1;
      else if (outcome.kind === "failed") result.failed += 1;
      else if (outcome.kind === "needs_reconciliation") result.needsReconciliation += 1;
      else result.notClaimed += 1;
    } catch {
      // The claim or its result could not be persisted. Do not retry this ID
      // here: a later run will only select it if it is still approved.
      result.errors += 1;
    } finally {
      budget.remainingMs = Math.max(0, budget.remainingMs - Math.max(0, now() - started));
    }
  }
  return result;
}

type Database = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  }>;
};

/** Query only eligible, approved intents, including manual events. */
export async function dispatchApprovedPostsWithSupabase(
  supabase: unknown,
  ownerId: string,
  eventId: string | null = null,
  fetchImpl?: typeof fetch,
  options: { budget?: DispatchBudget } = {},
): Promise<ApprovedDispatchResult> {
  const database = supabase as Database;
  return dispatchApprovedPosts(async () => {
    const { data, error } = await database.rpc("list_approved_posts_for_dispatch", {
      p_owner_id: ownerId,
      p_event_id: eventId,
      p_limit: 50,
    });
    if (error) throw new Error("No se pudieron cargar las publicaciones aprobadas pendientes.");
    return (data ?? []).map((row) => row.id);
  }, (postId) => schedulePostWithSupabase(postId, supabase, ownerId, fetchImpl), options);
}
