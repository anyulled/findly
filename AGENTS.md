<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project workflow

- Follow the RSI cycle for each workstream: Research current repository state and requirements, write a concise plan in the pull request description or a relevant `docs/` note, implement, and verify the result.
- Before finishing a workstream, update relevant documentation and synchronize with the current `main` branch. Resolve conflicts without discarding another workstream’s changes.
- Use Conventional Commits for every commit, for example `feat: add calendar view`, `ci: validate pull requests`, or `docs: document architecture`.
- Keep workstreams isolated in their own branches/worktrees and pull requests. Avoid editing files owned by another workstream; coordinate shared files before changes.
- Keep the solution within free tiers where practical. Do not enable paid services or incur costs.
- Do not commit secrets, credentials, or real user data.

## Workstream ownership

- Application: `src/`, database migrations, and application dependencies/configuration needed by the feature.
- CI/CD: `.github/workflows/` and deployment configuration. Coordinate edits to root package scripts before changing them.
- Documentation and diagrams: `docs/` and project-level contributor documentation.
