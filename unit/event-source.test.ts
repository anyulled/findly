import assert from "node:assert/strict";
import test from "node:test";
import { sourceForEventUrl } from "../src/lib/event-source";

test("classifies supported event page URLs", () => {
  assert.equal(sourceForEventUrl("https://luma.com/event"), "Luma");
  assert.equal(sourceForEventUrl("https://lu.ma/event"), "Luma");
  assert.equal(sourceForEventUrl("https://events.meetup.com/event"), "Meetup");
});

test("uses manual source for missing, invalid, or unrelated URLs", () => {
  assert.equal(sourceForEventUrl(null), "Manual");
  assert.equal(sourceForEventUrl("not a URL"), "Manual");
  assert.equal(sourceForEventUrl("https://notmeetup.com/event"), "Manual");
});
