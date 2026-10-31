# Testing

## End-to-end happy paths

The Playwright suite runs against the Next.js app in demo mode with an isolated browser context and an empty local store. This exercises the real UI and browser persistence while keeping Supabase, Groq, Buffer, Meetup, and Luma credentials and network services out of the run. These tests do not claim to verify provider integrations; add integration coverage when those services are available.

The current E2E coverage checks:

- Switching the calendar between its default fortnight view, week view, and month view.
- Creating an event eight days ahead, which leaves the one-week and one-day reminders in range and omits the two-week reminder. The generated drafts cover all seven configured social channels.
- Approving a draft, recording it as a style example, and retaining that approval after a page reload.

## Unit tests

`npm run test:unit` runs pure logic tests with Node's built-in `node:test` runner through `tsx`. These tests need no browser, service credentials, or network access. They cover social character counting, title-language fallback, Madrid timezone conversion, and the Luma iCalendar parsing boundary.

The iCalendar parser reads event `UID`, `SUMMARY`, `DESCRIPTION`, `LOCATION`, `URL`, and `DTSTART`. It relies on ical.js for RFC 5545 content-line folding and escaped text. UTC, embedded `VTIMEZONE`, IANA `TZID`, floating Madrid times, and date-only events are normalized to Madrid date/time. Malformed events produce per-event issues while valid events in the same calendar remain available. The parser does not fetch feeds, expand `RRULE` recurrences, or reconcile cancellation and date changes.

The browser uses the `Europe/Madrid` time zone. The test server binds to localhost port 3100 and receives empty Supabase settings to select demo mode.

## Run locally

```sh
npm ci
npm run test:unit
npx playwright install chromium
npm run test:e2e
```

CI installs Chromium and its system dependencies with `npx playwright install --with-deps chromium`. A failed run uploads the Playwright report and test results as a GitHub Actions artifact.

## RSI plan

1. Research the existing demo mode, calendar interactions, reminder generation, approval flow, and CI workflow.
2. Use Playwright with a local demo-mode server to cover representative user journeys without external credentials.
3. Run the suite and lint/build locally, document the tested boundary, then synchronize and open a pull request.
