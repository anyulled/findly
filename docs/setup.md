# Setup and operations

This guide describes the intended setup for the personal event publishing app. It does not mean external credentials or a production deployment have been configured. Follow the application README for the exact commands and environment variable names as implementation lands.

## Local development

1. Install the Node.js version supported by the `package.json` in the repository.
2. Install dependencies with `npm ci` and start the Next.js development server with `npm run dev`. The public landing is `/`; **Acceder** opens `/workspace`, where the calendar and settings live.
3. Copy the committed environment template when one is available. Put secrets only in an ignored local environment file; never commit it.
4. Until Supabase credentials are configured, sign-in, database-backed scheduling and provider calls cannot be exercised end to end.

## Provider setup checklist

### Supabase and Google sign-in

1. Create one Supabase project on a plan that meets the availability expectations.
2. Enable Google as an Auth provider and configure Google OAuth credentials and redirect URLs for local and deployed origins.
3. Restrict workspace access to the owner's Google identity. The landing page is public, while `/workspace` and the server actions remain protected. Successful sign-in returns to `/workspace`. There is one application user; do not add self-service registration for other members.
4. Apply the checked-in database migrations. Verify access policies before exposing the service to the public internet.
5. Keep elevated Supabase credentials on the server. A browser may receive only the public/publishable key, protected by row-level security. The cron importer uses `SUPABASE_SERVICE_ROLE_KEY` because it has no interactive owner session; it is server-only and must never use a `NEXT_PUBLIC_` name.

The first authenticated workspace load invokes an owner-scoped database function that inserts any missing managed accounts in one transaction. Stable managed-account keys and a unique owner/key constraint make concurrent loads and retries idempotent. Migration `202610310007` consolidates recognized legacy aliases while moving source links, Buffer channel mappings, posts and style examples to a deterministic surviving account. Before changing rows, it aborts with the conflicting owner/account/resource IDs if managed account settings, Buffer channels, or posts cannot be combined without a manual decision; resolve those conflicts without deleting data and retry the migration.

Supabase free projects may pause after a week of sufficiently low activity. This is a service availability behavior, not a data deletion guarantee; monitor the project and understand the resume process.

### Buffer

1. Confirm the Buffer API is available on the owner account, create an API key with the required scope, and store it as the server-only `BUFFER_API_KEY_PERSONAL`, `BUFFER_API_KEY_BARCELONA_JUG`, and `BUFFER_API_KEY_SOFTWARE_CRAFTERS_BARCELONA` secrets, one for each managed account.
2. In **Cuentas**, enter the Buffer channel ID for every configured account/network pair. A feed may target several accounts, but each post is sent to its account's matching network channel.
3. In global review mode, approve a post to schedule that one post and save its final text as a style example. Global automatic mode schedules newly generated posts immediately and does not create style examples.
4. Check the Buffer queue to verify the selected channel and exact Madrid publication time. Findly converts `due_at` to UTC and submits a `customScheduled` time; 13:00 Europe/Madrid changes between UTC offsets with daylight saving time.
5. Explicit Buffer rejections are marked failed; correct configuration or content and retry them. A timeout, server error or incomplete response is marked as needing reconciliation. Findly never retries that state automatically. Look up the post in Buffer and record its ID in the post detail before treating it as scheduled.
6. `scheduled` means Buffer accepted the queued post; it does not mean the social network has published it. No live Buffer credentials are included, so validate against the owner account before relying on production publication.

### Groq

1. Create an API key and store it only in server-side secrets.
2. Configure a production model ID explicitly rather than relying on an implicit default.
3. Expect account-specific rate limits. A throttled or failed request should leave a visible retryable item and must not create a partial schedule.
4. Account voice instructions belong to the per-account system prompt. Only final texts approved in review mode are added as style examples; generated text must still pass deterministic length checks.
5. Persistent-mode event creation requires `GROQ_API_KEY` and `GROQ_MODEL`; without them, the event remains saved and its reminders can be retried after configuration. Local demo mode uses deterministic templates without calling Groq.
6. Draft generation supports the configured maximum of 3 accounts × 3 networks × 3 reminder offsets (27 posts per event); larger configurations are rejected safely.

### Luma and event links

1. Save the Luma iCal subscription URL in **Settings → Event sources**, then associate it with one or more accounts.
2. In a signed-in owner session, use **Ajustes → Fuentes → Sincronizar ahora** to run the import manually. The same `POST /api/cron/sync` endpoint accepts a same-origin owner session or an external `Authorization: Bearer <CRON_SECRET>` request. The exact POST path bypasses browser-session middleware; session requests are checked against the configured owner and same-origin `Origin`, while cron calls use a constant-time bearer-secret check. When both `GROQ_API_KEY` and `GROQ_MODEL` are configured, missing reminders are generated for events returned by enabled feeds, using the account voice and matching approved examples. The global publishing mode controls whether new drafts stay in review or are submitted to Buffer automatically; automatic scheduling requires a configured Buffer API key and channel mapping for each account/network.
3. The route is safe to retry: existing `(owner, source, external ID)` records are ignored and never updated, and only missing reminder drafts are generated. If Groq is unconfigured or draft generation fails, the event remains saved; later syncs retry its missing reminders, and the event's **Crear recordatorios** action is also available. Meetup feed synchronization and API/OAuth integration remain unsupported. For a single public event, use the manual form URL extractor; it reads available public metadata and leaves missing values for review. Select at least one enabled account in the form: its selection is saved with the event and reused when completing reminders. Previously created manual events without a selection keep their original all-enabled-accounts behavior. Apply migration `202610310008` before deploying this version.
4. Feed fetches require HTTPS, reject redirects, time out after 10 seconds, and cap response bodies at 2 MB. Feed URLs are not included in the response. Date changes and cancellations remain out of scope.

### Recovering approved posts

The authenticated sync endpoint first scans up to 50 already-approved posts in due-time order, including posts from manual events and when Groq or Luma feeds are unavailable. Recovery and automatic delivery of imported events share a 10-second budget of time spent dispatching; time fetching feeds or generating text does not consume it. An already-started Buffer request can take up to its timeout. For imported events it only selects accounts still linked to the event source. Each delivery uses the existing atomic claim, and confirmed, failed, in-flight, and uncertain results are not automatically resubmitted. A failed provider response remains visible for an explicit retry; an uncertain response requires reconciliation. A new run continues the backlog, and the sync response reports separate recovery and new-event counts for selected, scheduled, failed, uncertain, deferred, and unexpected errors. The endpoint responds with HTTP 503 when a dispatch fails or needs reconciliation, so an external scheduler can signal the problem; failed and uncertain posts are not automatically retried. This also resumes a post approved before the global mode was changed to review: the approval was already granted. Recovery never creates another style example.

A connected owner can run **Ajustes → Fuentes → Sincronizar ahora** even without an active feed. If the response reports a full batch or deferred posts, run it again or wait for the next scheduled invocation. This requires the database migrations and the same server-only Buffer, Supabase service-role and authentication configuration as scheduled sync.

### Scheduled sync

1. Deploy the application to an eligible hosting plan and confirm its HTTPS URL.
2. Configure cron-job.org to call the sync endpoint every six hours over HTTPS.
3. Configure `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` as server-only deployment secrets. Send the random cron secret using the configured authorization header, never a query string.
4. Trigger a manual sync first and inspect the structured counts and safe issue codes. Then enable the recurring job.
5. Monitor failures. The sync operation is idempotent because external schedulers can retry or overlap requests.

## Secret inventory

Use the names in `.env.example`. Persistent-mode Groq draft generation needs `GROQ_API_KEY` and `GROQ_MODEL`; the deployment also needs Supabase URL/publishable key and owner email. The Luma sync endpoint needs server-side Supabase service-role and cron secrets. Buffer scheduling needs the three server-only per-account Buffer API keys and a Buffer channel ID for every account/network pair in **Cuentas**. The public Supabase URL and publishable key are configuration values, not privileged credentials; browser database access remains protected by RLS. Never place Buffer/Groq/service-role/cron values in a `NEXT_PUBLIC_` variable. `JEV_API_KEY` is a reserved empty placeholder; the application does not call Jev.

## Review and automatic modes

- **Review:** the system prepares a draft for each applicable reminder, account and channel. The owner can edit and approve; the same approval transaction stores the final text as a style example, then Findly schedules that post in Buffer.
- **Automatic:** the global preference schedules newly generated drafts in Buffer immediately. These drafts are not added to style examples.
- If a Buffer response is uncertain, Findly records `needs_reconciliation` and will not retry the post. Confirm it in Buffer and enter its post ID in Findly to reconcile. After checking the queue, the owner can confirm absence and then retry. Only known failures can be explicitly retried.
- A post in `scheduling` can still be in flight. Its absence cannot be confirmed and it cannot be retried. If it appears in Buffer, confirm the post ID; an eventual matching response from the original attempt is idempotent. A process interruption may leave `scheduling` stuck when no post is found. Do not bypass this lock or reset it based only on elapsed time: the original process could resume. Recovery of that case requires independent proof that the original attempt cannot execute; the application does not currently provide such a proof.
- The setting is global across all accounts. The demo mode remains local and never calls Buffer. Validate the connected account/channel mappings and scheduled queue before relying on automatic mode.

## Calendar and dates

Reminder candidates are 14, 7 and 1 calendar days before the event. Schedule each still-future candidate at 13:00 in `Europe/Madrid`; skip a candidate when that Madrid time is already past. Calendar weeks start Monday. The default range contains the current week and following week; weekly and calendar-month ranges are selectable.

## Operational limits and phase boundaries

- Date changes and cancellations are not synchronized automatically in the first phase. Update or cancel previously scheduled posts manually in Buffer.
- A successful `createPost` response means Buffer accepted the scheduled post; it does not prove the social network published it. Posts remain `scheduled` until publication status is available from the provider.
- On uncertain timeouts, do not blindly retry a create operation. The post remains `needs_reconciliation`; search the matching Buffer channel and record the discovered Buffer post ID in Findly.
- Vercel Hobby allows personal or non-commercial usage only under current terms. Confirm that the association use case is eligible or choose a different host/plan before production use.
- Free-tier quotas and terms change. Review provider dashboards before connecting the live scheduler, and avoid enabling paid upgrades without a deliberate decision.

### Alta manual por URL

1. In **Events**, paste any public HTTPS event page (e.g., from Luma, Meetup, or organizational event agendas), then select **Extract event data**.
2. Review the extracted title, date, time, location and description. Providers may omit fields or change their HTML; complete or correct any missing value before saving.
3. In deployed environments with Supabase configured, the extraction endpoint verifies the authenticated owner. Local development demo mode permits unauthenticated extraction for local use; production without Supabase returns a configuration error. Fetches require public HTTPS URLs protected against private IP ranges, local interfaces, and internal hosts, allowing at most three public HTTPS redirects and 1 MB of response HTML. Extraction tries schema.org JSON-LD first, then Open Graph/Twitter metadata, page titles, and heuristic DOM/text patterns for dates, times, and venues. A real provider URL has not yet been validated end to end, so the metadata returned by each event page can affect which fields are detected. This does not poll Meetup or replace the Luma iCal feed.
