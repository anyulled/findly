# CI/CD

## Continuous integration

`.github/workflows/ci.yml` runs for pull requests targeting `main` and pushes to `main`. It installs the lockfile dependencies with `npm ci`, runs ESLint, unit tests and a production build on Node.js 22, validates the mandatory Documentation and Sync checklist on pull requests, enforces per-file business logic coverage (80%) and the CRAP metric threshold (P20 / score <= 20) via `scripts/check-crap-score.mjs`, then runs the Playwright E2E happy paths in Chromium. Dependabot and Renovate dependency-update PRs skip the human-authored checklist; all required CI checks still run. GitHub Actions cancels an older run for the same branch when a newer commit arrives. The workflow has read-only repository permissions and needs no secrets. The required checks are `Documentation and Sync`, `Coverage (80%)`, and `E2E (Playwright)`.

The public repository is configured to allow rebase merges only. The `main` branch requires the `Coverage (80%)` and `E2E (Playwright)` checks, and auto-merge is enabled in repository settings. Select rebase when enabling auto-merge on a pull request.

## Continuous deployment

Use the hosting provider's Git integration to deploy from `main` and create preview deployments for pull requests. This keeps deploy credentials out of GitHub Actions and avoids paid runner/deployment automation. Connect the repository in the provider dashboard, select the repository root, and configure any production environment variables there. Do not commit `.env` files or credentials.

Before enabling a free hosting plan, confirm that its current terms allow the intended use for association accounts. If not, select a plan/provider whose terms fit. No deploy integration is enabled by this repository workflow itself.

## RSI plan

1. Research the existing Next.js scripts, lockfile, branch and GitHub Actions requirements.
2. Keep CI on lockfile installation, lint, production build, and mocked/demo E2E; use Git-native hosting integration for deployments.
3. Validate locally, update this document and [testing.md](testing.md), then synchronize the branch with `origin/main` before opening the pull request.
