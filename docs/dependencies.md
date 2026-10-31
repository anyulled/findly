# Dependency updates

Dependabot checks npm packages and GitHub Actions once per month through `.github/dependabot.yml`.

## Grouping

- Production npm dependencies are combined in one `production-dependencies` pull request.
- Development npm dependencies are combined in one `development-dependencies` pull request.
- GitHub Actions updates are combined in one `github-actions` pull request.

Security alerts and Dependabot security updates remain governed by the repository security settings; these version update groups do not replace urgent security remediation. Grouping intentionally includes all update levels to keep routine maintenance to at most three grouped pull requests per monthly run. Review the grouped changes and CI results before merging, especially major-version updates.

## RSI record

1. Research confirmed the repository uses npm (`package.json` and `package-lock.json`) and GitHub Actions (`.github/workflows/ci.yml`).
2. Plan: configure monthly version updates for both ecosystems, split npm production and development dependencies into separate groups, and group all workflow actions together.
3. Implement the schedule in `.github/dependabot.yml` and document the expected pull requests here.
4. Sync the branch with the latest `origin/main` before opening the pull request.
