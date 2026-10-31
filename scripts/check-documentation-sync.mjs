import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HEADING = "## Mandatory final stage: Documentation and Sync";
const REQUIRED_ITEMS = [
  "README and relevant docs match",
  "Setup instructions and environment variable references",
  "Documentation does not present",
  "Branch is rebased",
  "The PR description and checklist reflect",
];
const DEPENDENCY_BOTS = new Set(["dependabot[bot]", "renovate[bot]"]);

export function isTrustedDependencyBot(login) {
  return DEPENDENCY_BOTS.has(login);
}

export function documentationSyncIssues(body) {
  const start = body.indexOf(HEADING);
  if (start < 0) return [`Missing required section: ${HEADING}`];

  const section = body.slice(start + HEADING.length).split(/^## /mu, 1)[0];
  const issues = [];
  for (const label of REQUIRED_ITEMS) {
    const item = section.split("\n").find((line) => line.startsWith("- [") && line.includes(label));
    if (!item) issues.push(`Missing checklist item: ${label}`);
    else if (!/^- \[[xX]\]/u.test(item)) issues.push(`Checklist item is incomplete: ${label}`);
  }
  return issues;
}

function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required in CI.");
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const pullRequest = event.pull_request;
  if (!pullRequest) {
    process.stdout.write("Documentation checklist validation applies to pull requests only.\n");
    return;
  }
  if (isTrustedDependencyBot(pullRequest.user?.login)) {
    process.stdout.write("Trusted dependency-bot PR: human documentation checklist is not required; validation and E2E checks still run.\n");
    return;
  }

  const issues = documentationSyncIssues(pullRequest.body ?? "");
  if (issues.length > 0) {
    process.stderr.write(`Complete the mandatory Documentation and Sync checklist before merging:\n- ${issues.join("\n- ")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Documentation and Sync checklist is complete.\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
