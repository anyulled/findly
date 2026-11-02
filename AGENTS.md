<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Definition of Done (DoD)

Any work stream, task, feature, or bug fix performed by agents is considered complete **only** when all of the following criteria are satisfied:

1. **The implementation is done**: The code meets all requirements, follows SOLID/KISS principles, keeps Server Actions exception-safe with typed return results, and never swallows errors silently.
2. **We have tests supporting the development**: Automated tests supporting the feature or fix are included and passing. For business logic in `src/lib/*.ts`, line coverage must stay at or above 80%, CRAP score <= 10, and code duplication clones must be 0 (<= 1%). UI and route flows are covered by Playwright E2E tests where applicable.
3. **Code is committed and pushed to a pull request**: Changes are committed using Conventional Commits format, pushed to the remote branch/worktree, and a pull request is created.
4. **The pull request is linked to a GitHub issue**: The pull request description explicitly references and links the associated GitHub issue (e.g., `Closes #<issue>` or `Fixes #<issue>`).
5. **Branch conflicts are resolved, if any**: The branch is rebased onto the latest `origin/main` without dropping concurrent changes, and all CI checks pass after synchronization.
6. **CodeRabbit comments are resolved, if any**: All comments, suggestions, and review feedback from CodeRabbit (and human reviewers) are reviewed and addressed, and resolvable review threads are marked resolved.
7. **The pull request is auto-merged**: Auto-merge (rebase merge) is enabled after CodeRabbit review completes and any feedback is resolved in addition to all required status checks passing, and the pull request has successfully auto-merged into `main`.

## Project workflow

- Do not declare any task or workstream complete until every criterion in the Definition of Done (DoD) is satisfied.
- Follow the RSI cycle for each workstream in order: Research current repository state and requirements; write a concise plan in the pull request description or a relevant `docs/` note; implement and verify; then complete the mandatory final Documentation and Sync stage.
- Keep per-file line coverage at or above 80% for every business-logic module in `src/lib/*.ts`. Add or update unit tests with each implementation change; `npm run test:coverage` must pass before requesting merge. The CI `Coverage (80%)` check enforces this threshold.
- Put testable business rules in `src/lib/*.ts`; cover route and UI integration through focused unit tests where practical and the required Playwright E2E paths. See `docs/testing.md` for coverage scope and commands.
- Documentation and Sync is part of implementation completion, not follow-up work. Before requesting merge, update the README and relevant docs to match user-visible behavior, environment/configuration changes, test coverage, and known limitations. If no docs need changing, explain why in the pull request checklist.
- In the same final stage, rebase onto the latest `origin/main`, resolve conflicts without discarding another workstream’s changes, rerun the applicable checks, and confirm the pull request contains the documentation update. Do not mark a workstream complete while this stage remains unchecked.
- Use the repository pull request template and complete its documentation and synchronization checklist before merge.
- The `Documentation and Sync` GitHub Actions check validates that every final-stage checklist item is checked. The `main` branch must require this check, `E2E (Playwright)`, `Coverage (80%)`, and `Database migrations` before merge.
- Dependabot and Renovate dependency-update PRs are exempt from the human-authored checklist because those bots do not use the template; they still must pass lint, unit, build, Coverage (80%), Database migrations, Documentation and Sync, and E2E status checks. Keep this exemption limited to the exact trusted bot accounts in the CI validator.
- Use Conventional Commits for every commit, for example `feat: add calendar view`, `ci: validate pull requests`, or `docs: document architecture`.
- Keep workstreams isolated in their own branches/worktrees and pull requests. Avoid editing files owned by another workstream; coordinate shared files before changes.
- Keep the solution within free tiers where practical. Do not enable paid services or incur costs.
- Do not commit secrets, credentials, or real user data.

## Error reports and decision-making

- When the user reports an error, troubleshoot before changing code: reproduce it or gather evidence (logs, screenshots, stack traces, CI output, data), trace the execution path, and identify every root cause, not only the visible symptom.
- Report findings to the user with: the root cause(s) and the evidence behind them, two or more alternative fixes with trade-offs (scope, risk, effort, user-visible impact), and a recommended option.
- Do not choose or implement a fix without the user's confirmation, unless the change is minor. A change is minor when it is small, low-risk, easily reversible, and does not alter user-visible behavior, data/schema, public interfaces, architecture, or dependencies (for example a typo, an obvious one-line bug, a missing null check, or a log message). When in doubt, ask.

## Code quality

- Follow SOLID and KISS: keep modules and functions focused on a single responsibility, depend on small interfaces (inject I/O such as Supabase, Buffer, Groq, and `fetch`), avoid duplicated business rules, and prefer the simplest design that meets the requirement.
- Never swallow errors silently. Either handle them with an explicit, commented fallback or log them with context (operation, identifiers, error code) without leaking secrets or personal data, and surface a safe, user-friendly message.
- Server Actions must not throw across the client boundary: return typed result objects so production builds never mask failures as minified React errors.

## Workstream ownership

- Application: `src/`, database migrations, and application dependencies/configuration needed by the feature.
- CI/CD: `.github/workflows/` and deployment configuration. Coordinate edits to root package scripts before changing them.
- Documentation and diagrams: `docs/` and project-level contributor documentation.
