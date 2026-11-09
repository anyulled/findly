import assert from "node:assert/strict";
import test from "node:test";
import {
  paginateItems,
  getEventPlannedPosts,
  canGenerateEventDrafts,
  isPostDeletable,
} from "../src/lib/event-pagination";
import type { PostView } from "../src/app/workspace-actions";

test("paginateItems handles empty arrays safely", () => {
  const result = paginateItems([], 1, 6);
  assert.deepEqual(result.items, []);
  assert.equal(result.page, 1);
  assert.equal(result.totalPages, 1);
  assert.equal(result.totalCount, 0);
  assert.equal(result.startIndex, 0);
  assert.equal(result.endIndex, 0);
  assert.equal(result.hasNextPage, false);
  assert.equal(result.hasPreviousPage, false);
});

test("paginateItems paginates items correctly across pages", () => {
  const list = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const page1 = paginateItems(list, 1, 4);
  assert.deepEqual(page1.items, [1, 2, 3, 4]);
  assert.equal(page1.page, 1);
  assert.equal(page1.totalPages, 3);
  assert.equal(page1.hasNextPage, true);
  assert.equal(page1.hasPreviousPage, false);

  const page2 = paginateItems(list, 2, 4);
  assert.deepEqual(page2.items, [5, 6, 7, 8]);
  assert.equal(page2.page, 2);
  assert.equal(page2.hasNextPage, true);
  assert.equal(page2.hasPreviousPage, true);

  const page3 = paginateItems(list, 3, 4);
  assert.deepEqual(page3.items, [9, 10]);
  assert.equal(page3.page, 3);
  assert.equal(page3.hasNextPage, false);
  assert.equal(page3.hasPreviousPage, true);
});

test("paginateItems clamps out-of-range requested pages and handles negative/zero inputs", () => {
  const list = ["a", "b", "c"];
  const clampedHigh = paginateItems(list, 99, 2);
  assert.equal(clampedHigh.page, 2);
  assert.deepEqual(clampedHigh.items, ["c"]);

  const clampedLow = paginateItems(list, -5, 2);
  assert.equal(clampedLow.page, 1);
  assert.deepEqual(clampedLow.items, ["a", "b"]);

  const zeroPageSize = paginateItems(list, 1, 0);
  assert.equal(zeroPageSize.pageSize, 6);
});

test("getEventPlannedPosts filters by eventId and excludes discarded posts", () => {
  const mockPosts: PostView[] = [
    {
      id: "p1",
      eventId: "e1",
      date: "2026-11-15",
      time: "10:00",
      account: "Personal",
      network: "LinkedIn",
      text: "Event post 1",
      status: "review",
    },
    {
      id: "p2",
      eventId: "e2",
      date: "2026-11-12",
      time: "12:00",
      account: "Personal",
      network: "X",
      text: "Other event post",
      status: "review",
    },
    {
      id: "p3",
      eventId: "e1",
      date: "2026-11-10",
      time: "09:00",
      account: "Personal",
      network: "Bluesky",
      text: "Event post 2",
      status: "scheduled",
    },
    {
      id: "p4",
      eventId: "e1",
      date: "2026-11-15",
      time: "08:00",
      account: "Personal",
      network: "LinkedIn",
      text: "Event post early",
      status: "approved",
    },
    {
      id: "p5",
      eventId: "e1",
      date: "2026-11-11",
      time: "15:00",
      account: "Personal",
      network: "LinkedIn",
      text: "Discarded post",
      status: "discarded",
    },
  ];

  const planned = getEventPlannedPosts(mockPosts, "e1");
  assert.equal(planned.length, 3);
  assert.deepEqual(
    planned.map((p) => p.id),
    ["p3", "p4", "p1"],
  );
});

test("canGenerateEventDrafts returns true only when no posts or tombstones exist", () => {
  assert.equal(canGenerateEventDrafts([]), true);
  assert.equal(
    canGenerateEventDrafts([
      {
        id: "p1",
        eventId: "e1",
        date: "2026-11-15",
        time: "10:00",
        account: "Personal",
        network: "LinkedIn",
        text: "Discarded",
        status: "discarded",
      },
    ]),
    false,
  );
  assert.equal(
    canGenerateEventDrafts([
      {
        id: "p1",
        eventId: "e1",
        date: "2026-11-15",
        time: "10:00",
        account: "Personal",
        network: "LinkedIn",
        text: "Draft",
        status: "review",
      },
    ]),
    false,
  );
});

test("isPostDeletable allows deletion only for review and failed publications", () => {
  assert.equal(isPostDeletable("review"), true);
  assert.equal(isPostDeletable("failed"), true);
  assert.equal(isPostDeletable("scheduled"), false);
  assert.equal(isPostDeletable("approved"), false);
  assert.equal(isPostDeletable("published"), false);
  assert.equal(isPostDeletable("scheduling"), false);
  assert.equal(isPostDeletable("needs_reconciliation"), false);
  assert.equal(isPostDeletable("discarded"), false);
});
