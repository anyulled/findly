import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMadridDateTime, madridDateTimeToIso } from "../src/lib/madrid-time";

describe("Madrid date and time conversion", () => {
  for (const [date, time, expected] of [
    ["2026-01-10", "13:00", "2026-01-10T12:00:00.000Z"],
    ["2026-07-10", "13:00", "2026-07-10T11:00:00.000Z"],
  ] as const) {
    it(`converts ${date} ${time} using the Madrid seasonal offset`, () => {
      assert.equal(madridDateTimeToIso(date, time), expected);
      assert.deepEqual(formatMadridDateTime(expected), { date, time });
    });
  }
});
