import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { documentationSyncIssues } from "../scripts/check-documentation-sync.mjs";

const checklist = `## Mandatory final stage: Documentation and Sync

- [x] README and relevant docs match the behavior, configuration, and limitations changed by this PR, or explain why no documentation change is needed.
- [x] Setup instructions and environment variable references are current if configuration changed.
- [x] Documentation does not present planned or mocked integrations as implemented or live.
- [x] Branch is rebased on the latest origin/main, conflicts are resolved without dropping other work, and applicable checks passed after synchronization.
- [x] The PR description and checklist reflect the final implementation and verification results.
`;

describe("documentation sync PR checklist", () => {
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
});
