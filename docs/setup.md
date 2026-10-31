# Setup and operations

This guide describes the intended setup for the personal event publishing app. It does not mean external credentials or a production deployment have been configured. Follow the application README for the exact commands and environment variable names as implementation lands.

## Local development

1. Install the Node.js version supported by the `package.json` in the repository.
2. Install dependencies with `npm ci` and start the Next.js development server with `npm run dev`.
3. Copy the committed environment template when one is available. Put secrets only in an ignored local environment file; never commit it.
4. Until Supabase credentials are configured, sign-in, database-backed scheduling and provider calls cannot be exercised end to end.

## Provider setup checklist

### Supabase and Google sign-in

1. Create one Supabase project on a plan that meets the availability expectations.
2. Enable Google as an Auth provider and configure Google OAuth credentials and redirect URLs for local and deployed origins.
3. Restrict application access to the owner's Google identity. There is one application user; do not add self-service registration for other members.
4. Apply the checked-in database migrations. Verify access policies before exposing the service to the public internet.
5. Keep elevated Supabase credentials on the server. A browser may receive only the public/publishable key, protected by row-level security. The cron importer uses `SUPABASE_SERVICE_ROLE_KEY` because it has no interactive owner session; it is server-only and must never use a `NEXT_PUBLIC_` name.

Supabase free projects may pause after a week of sufficiently low activity. This is a service availability behavior, not a data deletion guarantee; monitor the project and understand the resume process.

### Buffer

1. Confirm the Buffer API is available on the owner account and create an API key with the intended scope.
2. Confirm all three Buffer accounts, their connected channels, and the publishing permissions available to the key.
3. Store the key only in server-side deployment secrets.
4. Verify how the API handles exact scheduled times, link counts, Unicode and each channel's limits against real connected channels.
5. Begin in global review mode. Confirm scheduled items appear in Buffer with the correct channel and Madrid time before enabling global automatic mode.

### Groq

1. Create an API key and store it only in server-side secrets.
2. Configure a production model ID explicitly rather than relying on an implicit default.
3. Expect account-specific rate limits. A throttled or failed request should leave a visible retryable item and must not create a partial schedule.
4. Account voice instructions belong to the per-account system prompt. Only final texts approved in review mode are added as style examples; generated text must still pass deterministic length checks.
5. Persistent-mode event creation requires `GROQ_API_KEY` and `GROQ_MODEL`; without them, the event remains saved and its reminders can be retried after configuration. Local demo mode uses deterministic templates without calling Groq.

### Luma and event links

1. Save the Luma iCal subscription URL in **Settings → Event sources**, then associate it with one or more accounts.
2. Invoke `POST /api/cron/sync` with `Authorization: Bearer <CRON_SECRET>` to fetch enabled Luma feeds and insert newly discovered events. The route is safe to retry: existing `(owner, source, external ID)` records are ignored and never updated.
3. The route does not create drafts or posts yet. Meetup synchronization and scraping are unsupported; add those events through the manual event form.
4. Feed fetches require HTTPS, reject redirects, time out after 10 seconds, and cap response bodies at 2 MB. Feed URLs are not included in the response. Date changes and cancellations remain out of scope.

### Scheduled sync

1. Deploy the application to an eligible hosting plan and confirm its HTTPS URL.
2. Configure cron-job.org to call the sync endpoint every six hours over HTTPS.
3. Configure `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` as server-only deployment secrets. Send the random cron secret using the configured authorization header, never a query string.
4. Trigger a manual sync first and inspect the structured counts and safe issue codes. Then enable the recurring job.
5. Monitor failures. The sync operation is idempotent because external schedulers can retry or overlap requests.

## Secret inventory

Use the names in `.env.example`. Persistent-mode Groq draft generation needs `GROQ_API_KEY` and `GROQ_MODEL`; the deployment also needs Supabase URL/publishable key and owner email. The Luma sync endpoint needs server-side Supabase service-role and cron secrets. Buffer credentials are needed when dashboard scheduling is implemented. The public Supabase URL and publishable key are configuration values, not privileged credentials; browser database access remains protected by RLS. Never place Buffer/Groq/service-role/cron values in a `NEXT_PUBLIC_` variable. `JEV_API_KEY` is a reserved empty placeholder; the application does not call Jev.

## Review and automatic modes

- **Review:** the system prepares a draft for each applicable reminder, account and channel. The owner can edit and approve; approval also records the final version as a style example. Buffer scheduling is not connected to the dashboard yet.
- **Automatic:** the preference is stored globally, but generated drafts still remain in review until Buffer scheduling is integrated. Selecting this mode does not currently publish or schedule content.
- The setting is global across all accounts. Enable automatic mode only after feed, identity, scheduling and character-count behavior have been checked with real provider accounts.

## Calendar and dates

Reminder candidates are 14, 7 and 1 calendar days before the event. Schedule each still-future candidate at 13:00 in `Europe/Madrid`; skip a candidate when that Madrid time is already past. Calendar weeks start Monday. The default range contains the current week and following week; weekly and calendar-month ranges are selectable.

## Operational limits and phase boundaries

- Date changes and cancellations are not synchronized automatically in the first phase. Update or cancel previously scheduled posts manually in Buffer.
- A successful `createPost` response means Buffer accepted the scheduled post; it does not prove the social network published it. Reconcile provider status separately.
- On uncertain timeouts, do not blindly retry a create operation. Look up the existing provider post using the persisted correlation data first.
- Vercel Hobby allows personal or non-commercial usage only under current terms. Confirm that the association use case is eligible or choose a different host/plan before production use.
- Free-tier quotas and terms change. Review provider dashboards before connecting the live scheduler, and avoid enabling paid upgrades without a deliberate decision.
