<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project workflow

- Follow the RSI cycle for each workstream in order: Research current repository state and requirements; write a concise plan in the pull request description or a relevant `docs/` note; implement and verify; then complete the mandatory final Documentation and Sync stage.
- Keep per-file line coverage at or above 80% for every business-logic module in `src/lib/*.ts`. Add or update unit tests with each implementation change; `npm run test:coverage` must pass before requesting merge. The CI `Coverage (80%)` check enforces this threshold.
- Put testable business rules in `src/lib/*.ts`; cover route and UI integration through focused unit tests where practical and the required Playwright E2E paths. See `docs/testing.md` for coverage scope and commands.
- Documentation and Sync is part of implementation completion, not follow-up work. Before requesting merge, update the README and relevant docs to match user-visible behavior, environment/configuration changes, test coverage, and known limitations. If no docs need changing, explain why in the pull request checklist.
- In the same final stage, rebase onto the latest `origin/main`, resolve conflicts without discarding another workstream’s changes, rerun the applicable checks, and confirm the pull request contains the documentation update. Do not mark a workstream complete while this stage remains unchecked.
- Use the repository pull request template and complete its documentation and synchronization checklist before merge.
- The `Documentation and Sync` GitHub Actions check validates that every final-stage checklist item is checked. The `main` branch must require this check, `E2E (Playwright)`, and `Coverage (80%)` before merge.
- Dependabot and Renovate dependency-update PRs are exempt from the human-authored checklist because those bots do not use the template; they still must pass lint, unit, build, Documentation and Sync, and E2E status checks. Keep this exemption limited to the exact trusted bot accounts in the CI validator.
- Use Conventional Commits for every commit, for example `feat: add calendar view`, `ci: validate pull requests`, or `docs: document architecture`.
- Keep workstreams isolated in their own branches/worktrees and pull requests. Avoid editing files owned by another workstream; coordinate shared files before changes.
- Keep the solution within free tiers where practical. Do not enable paid services or incur costs.
- Do not commit secrets, credentials, or real user data.

## Workstream ownership

- Application: `src/`, database migrations, and application dependencies/configuration needed by the feature.
- CI/CD: `.github/workflows/` and deployment configuration. Coordinate edits to root package scripts before changing them.
- Documentation and diagrams: `docs/` and project-level contributor documentation.
