# DC Email API — Project Overview

## What this is

A subscriber sync service that automatically moves fan emails from Daisy Chain's platforms into Beehiiv (the newsletter). Built with Next.js (App Router), deployed on Vercel.

**Repo**: `daisychainsd/dc-email-api` (renamed from `daisychain-mail` on 2026-05-02)
**Production URL**: `dc-email-api.vercel.app`

**Laylo** handles RSVPs and fan signups via live webhook. **Shotgun** is integrated directly via the Tickets API (daily cron). **Bandcamp** feeds directly via sales API (daily cron).

## What it does today

- **Bandcamp → Beehiiv**: A daily cron job (15:00 UTC) calls the Bandcamp sales API, pulls buyer emails since the last run, and subscribes them to Beehiiv. OAuth tokens are fetched automatically from Client ID + Secret and cached in Redis.
- **Laylo → Beehiiv**: A live webhook endpoint receives every fan sign-up event from Laylo (HMAC-SHA256 verified) and subscribes the email in real time.
- **Shotgun → Beehiiv**: A daily cron job (16:00 UTC) calls the Shotgun Tickets API, processes tickets page-by-page with cursor saved to Redis after each page (timeout-safe), and subscribes buyer emails to Beehiiv.
- **CSV import scripts**: Standalone local scripts for one-time historical imports. Deduplication is safe to re-run — Beehiiv treats existing subscribers as a no-op.
- **Cursor persistence**: After each Bandcamp run and each Shotgun page, the cursor is stored in Redis (Upstash) so the next run only fetches new records.
- **New vs existing tracking**: Cron responses distinguish new subscribers from duplicates (`newSubscribers` / `existingSubscribers` fields).
- **Failure alerts**: Both crons email `playerdave@daisychainsd.com` via Resend when errors occur or the function crashes.

## Subscriber counts (as of May 2026)

| Source | Approx. subscribers added |
|--------|--------------------------|
| Bandcamp (historical Aug 2024 – Mar 2026) | ~1,275 |
| Laylo (historical full export) | ~1,863 unique |
| Shotgun (historical audience CSV + API backfill + ongoing) | ~2,840 unique via API (duplicates handled by Beehiiv) |

## Architecture

```
Vercel Cron (daily 15:00 UTC)
  └─ GET /api/cron/bandcamp
       ├─ bandcampAuth.ts  → oauth_token (client_credentials, cached in Redis)
       ├─ bandcamp.ts      → sales_report v4 API
       ├─ processBandcamp.ts → throttled subscribe loop (100ms/req)
       └─ subscribe.ts     → beehiiv.ts → POST /v2/publications/{id}/subscriptions

Vercel Cron (daily 16:00 UTC)
  └─ GET /api/cron/shotgun
       ├─ Redis: get shotgun:last_after cursor
       ├─ processShotgun.ts → page-by-page fetch + subscribe (100ms/req)
       │    └─ saves cursor to Redis after each page (timeout-safe)
       └─ subscribe.ts → beehiiv.ts → POST /v2/publications/{id}/subscriptions

Laylo webhook (real-time)
  └─ POST /api/webhooks/laylo
       ├─ verify HMAC-SHA256 (X-Laylo-Timestamp + X-Signature-256)
       └─ extractEmail.ts → subscribe.ts → beehiiv.ts

Failure alerts
  └─ notify.ts → Resend API → playerdave@daisychainsd.com

CSV import (one-time historical, run locally)
  └─ node scripts/import-laylo-csv.mjs   — Laylo fan export
  └─ node scripts/import-shotgun-csv.mjs — Shotgun audience export
  └─ node scripts/backfill-local.mjs     — Bandcamp historical windows
```

## Environment variables

All set on Vercel production. Upstash Redis instance: `fast-gull-89445.upstash.io`.

| Variable | Purpose |
|----------|---------|
| `BEEHIIV_API_KEY` | Beehiiv Bearer token (Settings → API) |
| `BEEHIIV_PUBLICATION_ID` | `pub_c63c3433-d698-4e9b-b9cc-de4a2af0b2ed` |
| `BANDCAMP_CLIENT_ID` | Bandcamp OAuth app id (`2358`) |
| `BANDCAMP_CLIENT_SECRET` | Bandcamp OAuth app secret |
| `BANDCAMP_BAND_ID` | Daisy Chain label id (`1409963757`) |
| `BANDCAMP_INITIAL_START_TIME` | Lower bound for first cron run (`2026-01-01 00:00:00`) |
| `CRON_SECRET` | Protects `GET /api/cron/*` routes |
| `INTERNAL_SECRET` | Protects `/api/internal/*` routes |
| `LAYLO_WEBHOOK_SECRET` | Laylo-generated secret for HMAC-SHA256 webhook verification |
| `SHOTGUN_API_TOKEN` | Shotgun API token (Settings → Integrations → Shotgun APIs → Issue token) |
| `SHOTGUN_ORGANIZER_ID` | `216831` |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis (cursor + token cache) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token |
| `RESEND_API_KEY` | Resend API key for failure alert emails (shared with daisychain-site) |
| `NOTIFY_EMAIL` | Alert recipient (defaults to `playerdave@daisychainsd.com`) |

## API routes

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/cron/bandcamp` | GET | `CRON_SECRET` | Daily Bandcamp sync (15:00 UTC) |
| `/api/cron/shotgun` | GET | `CRON_SECRET` | Daily Shotgun ticket sync (16:00 UTC) |
| `/api/webhooks/laylo` | POST | HMAC-SHA256 | Real-time Laylo fan signups |
| `/api/internal/backfill` | POST | `INTERNAL_SECRET` | Trigger Bandcamp backfill for a date window |
| `/api/internal/import-csv` | POST | `INTERNAL_SECRET` | Bulk import from a CSV file body |

## Cron response format

Both crons return JSON with these fields:

```json
{
  "ok": true,
  "tickets": 150,
  "subscribed": 150,
  "newSubscribers": 45,
  "existingSubscribers": 105,
  "skippedNoEmail": 0,
  "failed": 0,
  "errors": [],
  "nextCursor": "2026-05-02T05:58:11.738Z_100245267",
  "redisConfigured": true
}
```

## Source files

```
src/
  app/
    api/
      cron/bandcamp/route.ts       — daily Bandcamp cron handler
      cron/shotgun/route.ts        — daily Shotgun cron handler
      webhooks/laylo/route.ts      — Laylo webhook handler (HMAC-SHA256 verified)
      internal/backfill/route.ts   — admin: Bandcamp backfill by date range
      internal/import-csv/route.ts — admin: CSV bulk import
  lib/
    bandcamp.ts        — Bandcamp sales_report API client
    bandcampAuth.ts    — OAuth token fetch + Redis cache
    beehiiv.ts         — Beehiiv subscribe API client (with retry + backoff, tracks new vs existing)
    extractEmail.ts    — Extract email from unknown webhook payload shape
    normalize.ts       — Trim + lowercase email, reject invalid
    notify.ts          — Failure alert emails via Resend
    processBandcamp.ts — Loop sales report, throttle (100ms), subscribe
    processShotgun.ts  — Page-by-page fetch + subscribe (100ms), cursor saved per page
    shotgun.ts         — Shotgun Tickets API client (paginated)
    state.ts           — Redis cursor read/write
    subscribe.ts       — normalise → Beehiiv (shared by all sources)
    auth.ts            — Bearer token check helper
scripts/
  backfill-local.mjs      — historical Bandcamp import (chunked date windows)
  backfill-shotgun.mjs    — historical Shotgun import via API (all tickets ever)
  import-laylo-csv.mjs    — historical Laylo fan CSV import
  import-shotgun-csv.mjs  — historical Shotgun audience CSV import
```

## Shotgun API notes

- The `after` cursor is an opaque value like `2026-04-23T07:58:31.404Z_99140586`, NOT a plain ISO date
- Returns 100 tickets per page, paginated via `pagination.next` URL
- Total historical tickets: ~5,000
- The cron processes page-by-page and saves cursor after each page, so if the Vercel function times out (300s limit), progress is preserved for the next run

## Running a CSV import locally

```bash
# Laylo
BEEHIIV_API_KEY=xxx BEEHIIV_PUBLICATION_ID=pub_xxx \
  node scripts/import-laylo-csv.mjs /path/to/laylo-export.csv

# Shotgun
BEEHIIV_API_KEY=xxx BEEHIIV_PUBLICATION_ID=pub_xxx \
  node scripts/import-shotgun-csv.mjs /path/to/audience.csv
```

Both scripts skip rows with no email, deduplicate, throttle at 300ms/request, and retry on network errors or rate limits.

## Remaining to-do

- **Bandcamp before August 2024** — if older sales exist, add an earlier window to `scripts/backfill-local.mjs` and re-run
- **Shotgun token expiry** — the Shotgun API token may expire. If the cron starts failing, go to Shotgun → Settings → Integrations → Shotgun APIs → Issue token, update `SHOTGUN_API_TOKEN` in Vercel, and redeploy. You'll get an email alert when this happens.
- **Delete old Vercel project** — the old `daisychain-mail` project still exists on Vercel and can be deleted

## Future ideas

- **Shopify orders → Beehiiv**: If merch ever moves off Laylo, add a `/api/webhooks/shopify` route with HMAC-SHA256 verification (same pattern as Laylo).
- **Beehiiv segments by source**: All subscribers are tagged with `utm_source`. In Beehiiv, create segments (bandcamp, laylo, shotgun) to send targeted campaigns to each audience.
- **Token auto-rotate reminder**: Bandcamp OAuth tokens are fetched automatically but the refresh token may expire. Add a Vercel Log Drain or email alert if Bandcamp auth fails in cron.
- **Upgrade to Vercel Pro**: Unlocks hourly cron (currently daily on Hobby). Worth it once subscriber volume justifies more frequent Bandcamp syncs.
- **Admin dashboard**: A simple password-protected page at `/admin` showing last sync time, subscriber counts per source, and a button to trigger backfill — so non-technical team members can monitor without Vercel access.
- **Laylo as master list**: Since all platforms funnel through Laylo, consider Laylo the canonical fan database and use Beehiiv purely for email sends. Segment campaigns by Laylo acquisition channel for better targeting.


## Physical Bandcamp order feed

`GET /api/internal/bandcamp-merch` is a read-only, `INTERNAL_SECRET`-protected feed for Daisy Chain Merch Ops. It calls Bandcamp `merchorders/4/get_orders` with the configured `BANDCAMP_BAND_ID` (and optional `BANDCAMP_MEMBER_BAND_ID`), all dates, shipped and unshipped. It uses the existing OAuth cache and returns physical merchandise only. This route does not subscribe buyers, move the sales-report cursor, mark Bandcamp orders shipped, or send email.

The site calls this feed hourly at minute 25, using its existing `DC_EMAIL_API_INTERNAL_SECRET`. The site owns normalization, Supabase persistence, deduplication and manual fulfillment. Physical Bandcamp orders appear alongside website orders at [Merch Ops](https://www.daisychainsd.com/ops/merch); digital music sales remain outside the shipping queue. Feed failures return 503 without exposing raw provider errors/customer data. Responses are never cached. Run `npm test` for auth, physical endpoint and error-path checks. See [site runbook](https://github.com/daisychainsd/daisychain-site/blob/main/OPERATIONS.md#bandcamp-physical-orders) and [deployment record](https://github.com/daisychainsd/daisychain-site/blob/main/BANDCAMP-ORDERS-2026-09-22.md).
