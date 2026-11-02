import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { documentationSyncIssues, isTrustedDependencyBot } from "../scripts/check-documentation-sync.mjs";

const checklist = `## Mandatory final stage: Documentation and Sync

- [x] README and relevant docs match the behavior, configuration, and limitations changed by this PR, or explain why no documentation change is needed.
- [x] Setup instructions and environment variable references are current if configuration changed.
- [x] Documentation does not present planned or mocked integrations as implemented or live.
- [x] Branch is rebased on the latest origin/main, conflicts are resolved without dropping other work, and applicable checks passed after synchronization.
- [x] The PR description and checklist reflect the final implementation and verification results.
`;

describe("documentation sync PR checklist", () => {
  it("recognizes only Dependabot and Renovate PR authors", () => {
    assert.equal(isTrustedDependencyBot("dependabot[bot]"), true);
    assert.equal(isTrustedDependencyBot("renovate[bot]"), true);
    assert.equal(isTrustedDependencyBot("some-other-bot[bot]"), false);
    assert.equal(isTrustedDependencyBot("anyulled"), false);
  });

  it("accepts all five completed final-stage items", () => {
    assert.deepEqual(documentationSyncIssues(checklist), []);
  });

  it("rejects an unchecked item", () => {
    const incomplete = checklist.replace("- [x] Setup instructions", "- [ ] Setup instructions");
    assert.deepEqual(documentationSyncIssues(incomplete), [
      "Checklist item is incomplete: Setup instructions and environment variable references",
    ]);
  });

  it("rejects a missing section or removed checklist item", () => {
    assert.equal(documentationSyncIssues("## Verification\nDone.")[0]?.startsWith("Missing required section"), true);
    const removed = checklist.replace(/^- \[x\] Documentation does not present.*\n/mu, "");
    assert.deepEqual(documentationSyncIssues(removed), [
      "Missing checklist item: Documentation does not present",
    ]);
  });

  it("validates that repository PR template contains Related Issue and Definition of Done checklist", () => {
    const templatePath = resolve(import.meta.dirname, "../.github/pull_request_template.md");
    const templateContent = readFileSync(templatePath, "utf8");

    assert.ok(templateContent.includes("## Related Issue"), "PR template must include Related Issue section");
    assert.ok(templateContent.includes("Closes #"), "PR template must link to GitHub issue");
    assert.ok(templateContent.includes("## Definition of Done"), "PR template must include Definition of Done");

    const expectedDoDItems = [
      "The implementation is done",
      "Tests supporting the development are included and passing",
      "Code is committed and pushed to a pull request",
      "The pull request is linked to a GitHub issue",
      "Branch conflicts are resolved, if any",
      "CodeRabbit comments are resolved, if any",
      "The pull request is auto-merged",
    ];

    for (const item of expectedDoDItems) {
      assert.ok(
        templateContent.includes(item),
        `PR template Definition of Done missing requirement: "${item}"`
      );
    }

    // Verify the template satisfies documentation sync when completed
    const completedTemplate = templateContent.replace(/- \[ \]/g, "- [x]");
    assert.deepEqual(documentationSyncIssues(completedTemplate), []);
  });
});
