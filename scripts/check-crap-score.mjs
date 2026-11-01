import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const DEFAULT_CRAP_THRESHOLD = 10;

/**
 * Calculates Cyclomatic Complexity (CC) for a given AST node.
 * Base complexity is 1, incremented by branching/decision nodes.
 * Nested function bodies are excluded (they are measured separately).
 */
export function calculateCyclomaticComplexity(node) {
  let complexity = 1;

  function walk(n) {
    if (
      n !== node &&
      (ts.isFunctionDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n) ||
        ts.isMethodDeclaration(n) ||
        ts.isGetAccessor(n) ||
        ts.isSetAccessor(n))
    ) {
      return;
    }

    switch (n.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ConditionalExpression:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CaseClause:
      case ts.SyntaxKind.CatchClause:
        complexity++;
        break;
      case ts.SyntaxKind.BinaryExpression:
        if (
          n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
        ) {
          complexity++;
        }
        break;
      default:
        break;
    }

    ts.forEachChild(n, walk);
  }

  ts.forEachChild(node, walk);
  return complexity;
}

/**
 * Calculates CRAP metric score:
 * CRAP(m) = CC(m)^2 * (1 - cov(m))^3 + CC(m)
 * where cov(m) is in [0, 1].
 */
export function calculateCrapScore(cc, cov) {
  const boundedCov = Math.min(1, Math.max(0, cov));
  const rawScore = Math.pow(cc, 2) * Math.pow(1 - boundedCov, 3) + cc;
  return Math.round(rawScore * 100) / 100;
}

/**
 * Computes given percentile from sorted numeric array.
 */
export function calculatePercentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, idx)];
}

/**
 * Analyzes CRAP scores for all functions in the target directory using coverage data.
 */
export function analyzeCrapMetrics({
  libDir = resolve("src/lib"),
  coverageData = {},
  threshold = DEFAULT_CRAP_THRESHOLD,
} = {}) {
  const files = readdirSync(libDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
  const functions = [];

  for (const file of files) {
    const fullPath = join(libDir, file);
    const content = readFileSync(fullPath, "utf8");
    const sourceFile = ts.createSourceFile(fullPath, content, ts.ScriptTarget.Latest, true);

    const covEntryKey = Object.keys(coverageData).find(
      (k) => k.endsWith(`src/lib/${file}`) || k.endsWith(`/${file}`),
    );
    const covEntry = covEntryKey ? coverageData[covEntryKey] : null;

    function findFunctions(node) {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessor(node) ||
        ts.isSetAccessor(node)
      ) {
        const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

        let name = "<anonymous>";
        if (node.name && "text" in node.name) {
          name = node.name.text;
        } else if (node.parent && ts.isVariableDeclaration(node.parent) && node.parent.name) {
          name = node.parent.name.getText(sourceFile);
        } else if (node.parent && ts.isPropertyAssignment(node.parent) && node.parent.name) {
          name = node.parent.name.getText(sourceFile);
        }

        const cc = calculateCyclomaticComplexity(node);

        // Collect inner nested function ranges so statements inside callbacks/closures
        // are attributed to the inner function, not the enclosing function.
        const innerFunctionRanges = [];
        function findInnerFunctions(child) {
          if (
            child !== node &&
            (ts.isFunctionDeclaration(child) ||
              ts.isFunctionExpression(child) ||
              ts.isArrowFunction(child) ||
              ts.isMethodDeclaration(child) ||
              ts.isGetAccessor(child) ||
              ts.isSetAccessor(child))
          ) {
            const { line: innerStart } = sourceFile.getLineAndCharacterOfPosition(child.getStart());
            const { line: innerEnd } = sourceFile.getLineAndCharacterOfPosition(child.getEnd());
            innerFunctionRanges.push({ start: innerStart + 1, end: innerEnd + 1 });
            return;
          }
          ts.forEachChild(child, findInnerFunctions);
        }
        ts.forEachChild(node, findInnerFunctions);

        let stmtsTotal = 0;
        let stmtsCovered = 0;
        if (covEntry && covEntry.statementMap && covEntry.s) {
          for (const [id, loc] of Object.entries(covEntry.statementMap)) {
            if (loc.start.line >= startLine + 1 && loc.end.line <= endLine + 1) {
              const isInsideNested = innerFunctionRanges.some(
                (range) => loc.start.line >= range.start && loc.end.line <= range.end,
              );
              if (!isInsideNested) {
                stmtsTotal++;
                if (covEntry.s[id] > 0) stmtsCovered++;
              }
            }
          }
        }

        // If no coverage entry exists for the file, fail closed (0% coverage).
        // If an entry exists but the function contains no statements, default to 1 (100%).
        const covRatio = !covEntry ? 0 : stmtsTotal > 0 ? stmtsCovered / stmtsTotal : 1;
        const crap = calculateCrapScore(cc, covRatio);

        functions.push({
          file,
          name,
          line: startLine + 1,
          cc,
          covPercent: Math.round(covRatio * 100),
          crap,
        });
      }
      ts.forEachChild(node, findFunctions);
    }

    ts.forEachChild(sourceFile, findFunctions);
  }

  functions.sort((a, b) => b.crap - a.crap);

  const crapValues = functions.map((f) => f.crap).sort((a, b) => a - b);
  const percentiles = {
    p20: calculatePercentile(crapValues, 20),
    p50: calculatePercentile(crapValues, 50),
    p75: calculatePercentile(crapValues, 75),
    p90: calculatePercentile(crapValues, 90),
    p95: calculatePercentile(crapValues, 95),
    max: crapValues.length > 0 ? crapValues[crapValues.length - 1] : 0,
  };

  const violations = functions.filter((f) => f.crap > threshold);

  return {
    threshold,
    totalFunctions: functions.length,
    percentiles,
    functions,
    violations,
  };
}

export function checkCodeDuplication({
  srcDir = "src",
  minTokens = 50,
  threshold = 1,
} = {}) {
  const jscpdBin = resolve("node_modules/.bin/jscpd");
  try {
    execFileSync(jscpdBin, [srcDir, "--min-tokens", String(minTokens), "--threshold", String(threshold)], {
      stdio: "inherit",
    });
    return true;
  } catch {
    return false;
  }
}

export function main() {
  const coverageFile = process.env.COVERAGE_FILE || resolve("coverage/coverage-final.json");
  const rawThreshold = process.env.CRAP_THRESHOLD;
  const threshold = rawThreshold !== undefined ? Number(rawThreshold) : DEFAULT_CRAP_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0) {
    process.stderr.write(`Invalid CRAP_THRESHOLD: ${rawThreshold}\n`);
    process.exitCode = 1;
    return;
  }
  const libDir = resolve(process.env.SRC_LIB_DIR || "src/lib");

  let coverageData = {};
  try {
    coverageData = JSON.parse(readFileSync(coverageFile, "utf8"));
  } catch (error) {
    process.stderr.write(
      `Error reading coverage report from ${coverageFile}. Make sure c8 was executed with --reporter=json.\n${error.message}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const result = analyzeCrapMetrics({ libDir, coverageData, threshold });

  process.stdout.write(`\n=== CRAP Metric Analysis (Threshold: <= ${threshold}) ===\n`);
  process.stdout.write(`Total functions analyzed: ${result.totalFunctions}\n`);
  process.stdout.write(
    `Percentiles: P20=${result.percentiles.p20} | P50=${result.percentiles.p50} | P75=${result.percentiles.p75} | P90=${result.percentiles.p90} | P95=${result.percentiles.p95} | Max=${result.percentiles.max}\n\n`,
  );

  const topToShow = result.functions.slice(0, 10);
  process.stdout.write("Top CRAP functions:\n");
  for (const fn of topToShow) {
    process.stdout.write(
      `  - ${fn.file}:${fn.line} ${fn.name} (CC: ${fn.cc}, Coverage: ${fn.covPercent}%, CRAP: ${fn.crap})\n`,
    );
  }

  if (result.violations.length > 0) {
    process.stderr.write(
      `\n❌ CRAP gate failed: ${result.violations.length} function(s) exceeded the threshold of ${threshold}:\n`,
    );
    for (const v of result.violations) {
      process.stderr.write(
        `  - ${v.file}:${v.line} ${v.name} -> CRAP score: ${v.crap} (CC: ${v.cc}, Cov: ${v.covPercent}%)\n`,
      );
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\n✅ CRAP gate passed: all functions have CRAP score <= ${threshold}.\n`);

  process.stdout.write("\n=== Code Duplication Analysis (jscpd) ===\n");
  const duplicationPassed = checkCodeDuplication();
  if (!duplicationPassed) {
    process.stderr.write("\n❌ Code duplication gate failed: duplicate blocks found or threshold exceeded.\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write("✅ Code duplication gate passed: no duplicate clones found.\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
