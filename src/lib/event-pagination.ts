import type { PostView } from "@/app/workspace-actions";

/**
 * Result structure returned by paginateItems.
 */
export interface PaginationResult<T> {
  /** Array of items on the current page. */
  items: T[];
  /** The 1-based current page index. */
  page: number;
  /** Number of items per page. */
  pageSize: number;
  /** Total number of pages available. */
  totalPages: number;
  /** Total count of all items across pages. */
  totalCount: number;
  /** Zero-based start index in the items array. */
  startIndex: number;
  /** Zero-based exclusive end index in the items array. */
  endIndex: number;
  /** Whether there is a subsequent page. */
  hasNextPage: boolean;
  /** Whether there is a preceding page. */
  hasPreviousPage: boolean;
}

/**
 * Paginates an array of items safely with 1-based indexing.
 *
 * @param items - The readonly array of items to paginate.
 * @param requestedPage - The requested 1-based page number.
 * @param pageSize - The maximum number of items per page.
 * @returns The pagination result containing sliced items and page metadata.
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
 *
 * @param posts - The array of all available workspace posts.
 * @param eventId - The unique identifier of the target event.
 * @returns An array of active posts sorted chronologically by date and time.
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
 * Returns true only when no publications (including discarded tombstones) exist for the event.
 *
 * @param eventPosts - The array of all posts associated with the event.
 * @returns True if draft generation can be initiated, false otherwise.
 */
export function canGenerateEventDrafts(eventPosts: readonly PostView[]): boolean {
  return eventPosts.length === 0;
}

/**
 * Determines whether a publication can be deleted/discarded from the workspace.
 * Only drafts awaiting review ('review') and failed posts ('failed') can be safely discarded;
 * scheduled or published posts cannot be deleted without external synchronization.
 *
 * @param status - The current publication status.
 * @returns True if the post can be deleted, false otherwise.
 */
export function isPostDeletable(status: PostView["status"]): boolean {
  return status === "review" || status === "failed";
}
