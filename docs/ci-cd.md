# CI/CD

## Continuous integration

`.github/workflows/ci.yml` runs for pull requests targeting `main` and pushes to `main`. It installs the lockfile dependencies with `npm ci`, runs ESLint and a production build on Node.js 22, then runs the Playwright E2E happy paths in Chromium. GitHub Actions cancels an older run for the same branch when a newer commit arrives. The workflow has read-only repository permissions and needs no secrets. The E2E job is named `E2E (Playwright)`.

The repository is configured to allow rebase merges only. GitHub currently blocks required branch checks and auto-merge for this private repository on its Free plan. Once the repository plan supports those controls, make `E2E (Playwright)` a required check and enable auto-merge in repository settings.

## Continuous deployment

Use the hosting provider's Git integration to deploy from `main` and create preview deployments for pull requests. This keeps deploy credentials out of GitHub Actions and avoids paid runner/deployment automation. Connect the repository in the provider dashboard, select the repository root, and configure any production environment variables there. Do not commit `.env` files or credentials.

Before enabling a free hosting plan, confirm that its current terms allow the intended use for association accounts. If not, select a plan/provider whose terms fit. No deploy integration is enabled by this repository workflow itself.

## RSI plan

1. Research the existing Next.js scripts, lockfile, branch and GitHub Actions requirements.
2. Keep CI on lockfile installation, lint, production build, and mocked/demo E2E; use Git-native hosting integration for deployments.
3. Validate locally, update this document and [testing.md](testing.md), then synchronize the branch with `origin/main` before opening the pull request.
