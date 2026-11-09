import type { PostView } from "@/app/workspace-actions";

export interface PaginationResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  startIndex: number;
  endIndex: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * Paginates an array of items safely with 1-based indexing.
 */
export function paginateItems<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize: number,
): PaginationResult<T> {
  const safePageSize = Math.max(1, Math.floor(pageSize || 6));
  const totalCount = items.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));
  const page = Math.min(Math.max(1, Math.floor(requestedPage || 1)), totalPages);

  const startIndex = (page - 1) * safePageSize;
  const endIndex = Math.min(totalCount, startIndex + safePageSize);
  const paginatedItems = items.slice(startIndex, endIndex);

  return {
    items: paginatedItems,
    page,
    pageSize: safePageSize,
    totalPages,
    totalCount,
    startIndex,
    endIndex,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

/**
 * Filters and sorts the planned (non-discarded) publications for a specific event.
 */
export function getEventPlannedPosts(
  posts: readonly PostView[],
  eventId: string,
): PostView[] {
  return posts
    .filter((post) => post.eventId === eventId && post.status !== "discarded")
    .sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return a.time.localeCompare(b.time);
    });
}

/**
 * Determines whether an event is eligible for generating draft publications.
 */
export function canGenerateEventDrafts(eventPosts: readonly PostView[]): boolean {
  return eventPosts.filter((post) => post.status !== "discarded").length === 0;
}
