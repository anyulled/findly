import { schedulePostWithSupabase, type PostPublishingOutcome } from "./post-publishing";

export type ApprovedDispatchResult = {
  selected: number;
  scheduled: number;
  failed: number;
  needsReconciliation: number;
  notClaimed: number;
  errors: number;
};

/** Resume durable approved intents. Each scheduler atomically claims its post. */
export async function dispatchApprovedPosts(
  listApproved: () => Promise<string[]>,
  schedule: (postId: string) => Promise<PostPublishingOutcome>,
): Promise<ApprovedDispatchResult> {
  const postIds = await listApproved();
  const result: ApprovedDispatchResult = { selected: postIds.length, scheduled: 0, failed: 0, needsReconciliation: 0, notClaimed: 0, errors: 0 };
  for (const postId of postIds) {
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
  }, (postId) => schedulePostWithSupabase(postId, supabase, ownerId, fetchImpl));
}
