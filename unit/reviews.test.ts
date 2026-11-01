import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canBatchApprove,
  countReviewPosts,
  filterReviewPosts,
  getBatchApproveTargets,
  groupReviewPostsByEvent,
  isReviewAttentionPost,
} from "../src/lib/reviews";

describe("reviews business logic", () => {
  it("determines whether a post requires review attention", () => {
    assert.equal(isReviewAttentionPost({ status: "review" }), true);
    assert.equal(isReviewAttentionPost({ status: "failed" }), true);
    assert.equal(isReviewAttentionPost({ status: "approved" }), false);
    assert.equal(isReviewAttentionPost({ status: "scheduled" }), false);
    assert.equal(isReviewAttentionPost({ status: "published" }), false);
    assert.equal(isReviewAttentionPost({ status: "discarded" }), false);
  });

  it("counts review and failed posts accurately", () => {
    const posts = [
      { status: "review" },
      { status: "review" },
      { status: "failed" },
      { status: "approved" },
      { status: "scheduled" },
      { status: "discarded" },
    ];
    const counts = countReviewPosts(posts);
    assert.deepEqual(counts, {
      total: 3,
      review: 2,
      failed: 1,
    });
  });

  it("handles empty lists when counting review posts", () => {
    assert.deepEqual(countReviewPosts([]), {
      total: 0,
      review: 0,
      failed: 0,
    });
  });

  it("filters review posts according to the selected filter tab", () => {
    const posts = [
      { id: "1", status: "review" },
      { id: "2", status: "failed" },
      { id: "3", status: "approved" },
      { id: "4", status: "scheduled" },
    ];

    const all = filterReviewPosts(posts, "all");
    assert.deepEqual(all.map((p) => p.id), ["1", "2"]);

    const onlyReview = filterReviewPosts(posts, "review");
    assert.deepEqual(onlyReview.map((p) => p.id), ["1"]);

    const onlyFailed = filterReviewPosts(posts, "failed");
    assert.deepEqual(onlyFailed.map((p) => p.id), ["2"]);
  });

  it("groups posts by event and sorts groups by upcoming event date and title", () => {
    const events = [
      { id: "ev-2", title: "Later Event", date: "2026-11-20", time: "18:00" },
      { id: "ev-1", title: "Earlier Event", date: "2026-11-10", time: "19:00" },
      { id: "ev-same-b", title: "Same Date Event B", date: "2026-11-15", time: "10:00" },
      { id: "ev-same-a", title: "Same Date Event A", date: "2026-11-15", time: "10:00" },
    ];

    const posts = [
      { id: "p-2-1", eventId: "ev-2", status: "review", date: "2026-11-19", time: "10:00" },
      { id: "p-1-2", eventId: "ev-1", status: "failed", date: "2026-11-09", time: "14:00" },
      { id: "p-1-1", eventId: "ev-1", status: "review", date: "2026-11-03", time: "12:00" },
      { id: "p-same-b", eventId: "ev-same-b", status: "review", date: "2026-11-14", time: "09:00" },
      { id: "p-same-a", eventId: "ev-same-a", status: "review", date: "2026-11-14", time: "09:00" },
      { id: "p-orphan", eventId: "ev-unknown", status: "review", date: "2026-11-01", time: "09:00" },
    ];

    const groups = groupReviewPostsByEvent(posts, events);

    // Groups should be sorted by event date ascending: ev-1 (Nov 10), ev-same-a, ev-same-b (Nov 15), ev-2 (Nov 20), ev-unknown (orphan: 9999-99-99)
    assert.equal(groups.length, 5);
    assert.equal(groups[0]?.eventId, "ev-1");
    assert.equal(groups[1]?.eventId, "ev-same-a");
    assert.equal(groups[2]?.eventId, "ev-same-b");
    assert.equal(groups[3]?.eventId, "ev-2");
    assert.equal(groups[4]?.eventId, "ev-unknown");
    assert.equal(groups[4]?.event, undefined);

    // Posts inside ev-1 should be sorted by schedule date/time: p-1-1 then p-1-2
    assert.deepEqual(groups[0]?.posts.map((p) => p.id), ["p-1-1", "p-1-2"]);
  });

  it("checks batch approval eligibility and retrieves targets", () => {
    const mixed = [
      { id: "1", status: "review" },
      { id: "2", status: "failed" },
    ];
    assert.equal(canBatchApprove(mixed), true);
    assert.deepEqual(getBatchApproveTargets(mixed).map((p) => p.id), ["1"]);

    const onlyFailed = [
      { id: "2", status: "failed" },
    ];
    assert.equal(canBatchApprove(onlyFailed), false);
    assert.deepEqual(getBatchApproveTargets(onlyFailed), []);
  });
});
