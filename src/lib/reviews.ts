export type ReviewFilter = "all" | "review" | "failed";

export interface ReviewCounts {
  total: number;
  review: number;
  failed: number;
}

export interface EventReviewGroup<
  P extends { id: string; eventId: string; status: string; date?: string; time?: string },
  E extends { id: string; date: string; time?: string; title?: string },
> {
  eventId: string;
  event: E | undefined;
  posts: P[];
}

export function isReviewAttentionPost(post: { status: string }): boolean {
  return post.status === "review" || post.status === "failed";
}

export function countReviewPosts(posts: ReadonlyArray<{ status: string }>): ReviewCounts {
  let review = 0;
  let failed = 0;

  for (const post of posts) {
    if (post.status === "review") {
      review += 1;
    } else if (post.status === "failed") {
      failed += 1;
    }
  }

  return {
    total: review + failed,
    review,
    failed,
  };
}

export function filterReviewPosts<P extends { status: string }>(
  posts: ReadonlyArray<P>,
  filter: ReviewFilter,
): P[] {
  return posts.filter((post) => {
    if (filter === "review") return post.status === "review";
    if (filter === "failed") return post.status === "failed";
    return post.status === "review" || post.status === "failed";
  });
}

export function groupReviewPostsByEvent<
  P extends { id: string; eventId: string; status: string; date?: string; time?: string },
  E extends { id: string; date: string; time?: string; title?: string },
>(posts: ReadonlyArray<P>, events: ReadonlyArray<E>): EventReviewGroup<P, E>[] {
  const groupsByEventId = new Map<string, P[]>();
  const eventMap = new Map<string, E>();

  for (const event of events) {
    eventMap.set(event.id, event);
  }

  for (const post of posts) {
    const existing = groupsByEventId.get(post.eventId);
    if (existing) {
      existing.push(post);
    } else {
      groupsByEventId.set(post.eventId, [post]);
    }
  }

  const result: EventReviewGroup<P, E>[] = [];

  for (const [eventId, groupPosts] of groupsByEventId.entries()) {
    const event = eventMap.get(eventId);
    // Sort posts within group by scheduled date and time
    groupPosts.sort((a, b) => {
      const dateA = `${a.date ?? ""}T${a.time ?? "00:00"}`;
      const dateB = `${b.date ?? ""}T${b.time ?? "00:00"}`;
      return dateA.localeCompare(dateB);
    });

    result.push({
      eventId,
      event,
      posts: groupPosts,
    });
  }

  // Sort groups by event date ascending (earliest/upcoming events first)
  result.sort((a, b) => {
    const dateA = a.event?.date ? `${a.event.date}T${a.event.time ?? "00:00"}` : "9999-99-99";
    const dateB = b.event?.date ? `${b.event.date}T${b.event.time ?? "00:00"}` : "9999-99-99";
    const dateCompare = dateA.localeCompare(dateB);
    if (dateCompare !== 0) return dateCompare;
    return (a.event?.title ?? "").localeCompare(b.event?.title ?? "");
  });

  return result;
}

export function canBatchApprove(posts: ReadonlyArray<{ status: string }>): boolean {
  return posts.some((p) => p.status === "review");
}

export function getBatchApproveTargets<P extends { id: string; status: string }>(
  posts: ReadonlyArray<P>,
): P[] {
  return posts.filter((p) => p.status === "review");
}
