# Testing

## End-to-end happy paths

The Playwright suite runs against the Next.js app in demo mode with an isolated browser context and an empty local store. This exercises the real UI and browser persistence while keeping Supabase, Groq, Buffer, Meetup, and Luma credentials and network services out of the run. These tests do not claim to verify provider integrations; add integration coverage when those services are available.

The current E2E coverage checks:

- Public landing at `/`, the top-right **Acceder** link into `/workspace`, and responsive layout at 375, 768, 1024 and 1440 pixels.
- Switching the calendar between its default fortnight, week, and month views.
- Creating an event eight days ahead, which leaves the one-week and one-day reminders in range and omits the two-week reminder. The generated drafts cover all seven configured social channels.
- Approving a draft, recording it as a style example, and retaining that approval after a page reload.
- Expanding a day with seven publications, opening and approving each account/channel with the keyboard, and opening a simulated uncertain publication that was initially hidden. This checks access to the existing reconciliation UI in demo mode; it does not exercise Buffer.
- Pasting an event URL, receiving mocked extracted details from the route, reviewing the populated fields, and saving the event.
- Distinguishing an active Buffer send from an uncertain result: absence cannot be confirmed while the send is active.

## Unit tests and coverage

`npm run test:unit` runs logic tests with Node's built-in `node:test` runner through `tsx`. These tests need no browser, service credentials, or network access.

Every TypeScript business-logic module directly under `src/lib/` must maintain at least 80% line coverage on its own. The `Coverage (80%)` CI job runs the unit suite with `c8 --all` and checks every matching module per file, including modules that no test imports. This prevents a highly covered module from masking an untested one and prevents new modules from silently escaping the gate.

In addition to line coverage, CI enforces the CRAP (Change Risk Anti-Patterns) metric quality gate (`npm run test:crap`). Every function in `src/lib/*.ts` must respect an absolute threshold of CRAP <= 20 ($\text{CRAP}(m) = CC(m)^2 \times (1 - \text{cov}(m))^3 + CC(m)$). Functions exceeding this threshold represent an unsafe combination of cyclomatic complexity and insufficient coverage and fail the CI check.

The gate measures `src/lib/*.ts`, where deterministic domain and provider logic belongs. UI components and Next.js route wiring are exercised by the Playwright E2E suite; Supabase client construction wrappers are configuration glue rather than domain logic. Keep route handlers thin and move testable rules into `src/lib/` so the coverage gate sees them.

The event URL extractor is covered by fetch-mocked unit cases for JSON-LD, metadata fallback, Madrid time conversion, unsupported hosts, redirects and response bounds. These cases verify parser behavior without requesting live Meetup or Luma pages. The authenticated sync request's same-origin guard has unit coverage; the demo E2E verifies that feed sync stays disabled without Supabase credentials. Source targeting tests exercise the shared account selection rule, missing reminder keys, and the Luma generation and dispatch orchestration with mocked repositories and generators in both review and automatic modes. A source with no associated enabled accounts produces no drafts; manual events select all enabled accounts.

The OAuth callback tests exercise code exchange success and failure with a simulated exchange function. A successful callback without a `next` parameter goes to `/workspace`. Redirect destinations are resolved against the application origin, and external, protocol-relative, backslash-normalized, and credential-bearing values fall back to `/`. These tests do not contact Supabase or exercise a live OAuth provider.

The required `Database migrations` CI check uses an isolated local Postgres database to apply all Supabase migrations in order, lint the resulting schema and functions, and execute every transactional SQL script under `supabase/tests/`. The reconciliation SQL regression exercises RLS and real state transitions, including concurrent claim prevention and fencing of stale responses. It does not connect to the hosted project; deployment happens only after a migration reaches `main`. See [database migrations](database-migrations.md) for the local command and deployment configuration.

The iCalendar parser reads event `UID`, `SUMMARY`, `DESCRIPTION`, `LOCATION`, `URL`, and `DTSTART`. It relies on ical.js for RFC 5545 content-line folding and escaped text. UTC, embedded `VTIMEZONE`, IANA `TZID`, floating Madrid times, and date-only events are normalized to Madrid date/time. Malformed events produce per-event issues while valid events in the same calendar remain available. The parser does not fetch feeds, expand `RRULE` recurrences, or reconcile cancellation and date changes.

Focused proxy unit tests also verify that the public landing does not contact Supabase and that an unconfigured production workspace redirects to the login page. The browser uses the `Europe/Madrid` time zone. The test server binds to localhost port 3100 and receives empty Supabase settings to select demo mode.

## Run locally

```sh
npm ci
npm run test:unit
npm run test:coverage
npm run test:crap
npx playwright install chromium
npm run test:e2e
supabase db start
supabase db reset --local --no-seed
supabase db lint --local --fail-on error
```

CI installs Chromium and its system dependencies with `npx playwright install --with-deps chromium`. A failed run uploads the Playwright report and test results as a GitHub Actions artifact. The `Coverage (80%)` and `Database migrations` jobs are independent required checks for pull requests; a failure blocks merge even if the regular unit test job passes. The database commands require Docker and the Supabase CLI.
