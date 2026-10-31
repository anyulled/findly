import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateCrapScore,
  calculatePercentile,
  DEFAULT_CRAP_THRESHOLD,
  analyzeCrapMetrics,
} from "../scripts/check-crap-score.mjs";

describe("CRAP metric calculation and gating", () => {
  it("calculates exact CRAP formula for 100% coverage", () => {
    // When cov = 1, CRAP = CC
    assert.equal(calculateCrapScore(1, 1), 1);
    assert.equal(calculateCrapScore(5, 1), 5);
    assert.equal(calculateCrapScore(18, 1), 18);
  });

  it("calculates exact CRAP formula for 0% coverage", () => {
    // When cov = 0, CRAP = CC^2 * (1)^3 + CC = CC^2 + CC
    assert.equal(calculateCrapScore(1, 0), 2); // 1 + 1
    assert.equal(calculateCrapScore(2, 0), 6); // 4 + 2
    assert.equal(calculateCrapScore(4, 0), 20); // 16 + 4
    assert.equal(calculateCrapScore(5, 0), 30); // 25 + 5
  });

  it("calculates exact CRAP formula for partial coverage", () => {
    // CC = 10, cov = 0.5 -> 100 * (0.125) + 10 = 12.5 + 10 = 22.5
    assert.equal(calculateCrapScore(10, 0.5), 22.5);
    // CC = 10, cov = 0.8 -> 100 * (0.008) + 10 = 0.8 + 10 = 10.8
    assert.equal(calculateCrapScore(10, 0.8), 10.8);
  });

  it("bounds coverage to range [0, 1]", () => {
    assert.equal(calculateCrapScore(10, 1.5), 10);
    assert.equal(calculateCrapScore(4, -0.5), 20);
  });

  it("computes percentiles accurately", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(calculatePercentile(values, 20), 2);
    assert.equal(calculatePercentile(values, 50), 5);
    assert.equal(calculatePercentile(values, 90), 9);
    assert.equal(calculatePercentile(values, 100), 10);
    assert.equal(calculatePercentile([], 20), 0);
  });

  it("flags functions exceeding threshold and returns percentiles", () => {
    // Analyze existing src/lib with default threshold
    const result = analyzeCrapMetrics({ threshold: DEFAULT_CRAP_THRESHOLD });
    assert.equal(result.threshold, 20);
    assert.equal(result.violations.length, 0);
    assert.ok(result.totalFunctions > 0);
    assert.ok(result.percentiles.max <= 20);

    // If threshold was set to a very low value (e.g. 5), violations are reported
    const strictResult = analyzeCrapMetrics({ threshold: 5 });
    assert.ok(strictResult.violations.length > 0);
    assert.ok(strictResult.violations.every((v) => v.crap > 5));
  });
});
