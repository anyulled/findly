import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  calculateCrapScore,
  calculatePercentile,
  DEFAULT_CRAP_THRESHOLD,
  analyzeCrapMetrics,
  main,
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

  it("analyzes fixtures with isolated nested statements and fail-closed coverage", () => {
    const testDir = mkdtempSync(join(tmpdir(), "crap-fixture-"));

    try {
      // Create a fixture file with an outer function containing branching AND an inner callback
      const fixtureCode = `
export function processItems(items: number[], flag: boolean): number[] {
  if (flag) {
    return items.map((x) => {
      if (x > 0) return x * 2;
      return 0;
    });
  }
  return [];
}

export function uncoveredHighComplexity(a: number, b: number, c: number): number {
  if (a > 0) return 1;
  if (b > 0) return 2;
  if (c > 0) return 3;
  if (a + b > 5) return 4;
  return 0;
}
`;
      writeFileSync(join(testDir, "fixture.ts"), fixtureCode);

      // Statement coverage:
      // Outer function lines 2-10 has statement on line 3 (if), line 4 (return), line 9 (return).
      // Inner callback lines 4-7 has statement on line 5 (if), line 6 (return).
      const mockCoverage = {
        "/src/lib/fixture.ts": {
          statementMap: {
            "0": { start: { line: 3, column: 2 }, end: { line: 8, column: 3 } }, // outer covered
            "1": { start: { line: 4, column: 4 }, end: { line: 7, column: 7 } }, // outer covered
            "2": { start: { line: 5, column: 6 }, end: { line: 5, column: 29 } }, // inner callback covered
            "3": { start: { line: 6, column: 6 }, end: { line: 6, column: 15 } }, // inner callback covered
            "4": { start: { line: 9, column: 2 }, end: { line: 9, column: 12 } }, // outer uncovered
            "5": { start: { line: 13, column: 2 }, end: { line: 13, column: 21 } }, // uncoveredHighComplexity
            "6": { start: { line: 14, column: 2 }, end: { line: 14, column: 21 } },
            "7": { start: { line: 15, column: 2 }, end: { line: 15, column: 21 } },
            "8": { start: { line: 16, column: 2 }, end: { line: 16, column: 25 } },
            "9": { start: { line: 17, column: 2 }, end: { line: 17, column: 11 } },
          },
          s: {
            "0": 1,
            "1": 1,
            "2": 1,
            "3": 1,
            "4": 0, // line 9 uncovered
            "5": 0,
            "6": 0,
            "7": 0,
            "8": 0,
            "9": 0,
          },
        },
      };

      const result = analyzeCrapMetrics({
        libDir: testDir,
        coverageData: mockCoverage,
        threshold: DEFAULT_CRAP_THRESHOLD,
      });

      // Check processItems: outer statements total = 2 (0, 4), covered = 1 (0).
      // Statements 1, 2, 3 spanning or inside the callback lines 4-7 are excluded from outer statements.
      const outerFn = result.functions.find((f) => f.name === "processItems");
      assert.ok(outerFn);
      assert.equal(outerFn.covPercent, 50); // 1/2 = 50%

      // Check inner callback is evaluated separately
      const innerFn = result.functions.find((f) => f.name === "<anonymous>");
      assert.ok(innerFn);
      assert.equal(innerFn.covPercent, 100); // 2/2 = 100%

      // uncoveredHighComplexity has CC=5 and 0% coverage -> CRAP = 5^2 + 5 = 30 > 20
      const uncoveredFn = result.functions.find((f) => f.name === "uncoveredHighComplexity");
      assert.ok(uncoveredFn);
      assert.equal(uncoveredFn.crap, 30);
      assert.equal(result.violations.length, 1);
      assert.equal(result.violations[0].name, "uncoveredHighComplexity");

      // Verify missing coverage file fails closed (0% coverage)
      const missingCovResult = analyzeCrapMetrics({
        libDir: testDir,
        coverageData: {},
        threshold: 10,
      });
      // Without coverage entry, every function gets covRatio = 0
      assert.ok(missingCovResult.functions.every((f) => f.covPercent === 0));
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("validates CRAP_THRESHOLD environment variable in main()", () => {
    const originalEnv = process.env.CRAP_THRESHOLD;
    const originalExit = process.exitCode;
    try {
      process.env.CRAP_THRESHOLD = "invalid_number";
      main();
      assert.equal(process.exitCode, 1);
    } finally {
      process.env.CRAP_THRESHOLD = originalEnv;
      process.exitCode = originalExit;
    }
  });
});
