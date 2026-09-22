# DC Email API — Operations

## What this system does
Funnels fan emails from three platforms into the Beehiiv newsletter list:
- **Bandcamp** sales — daily cron poll (15:00 UTC)
- **Shotgun** ticket buyers — daily cron poll (16:00 UTC)
- **Laylo** signups — real-time HMAC-verified webhook

All paths converge on `src/lib/subscribe.ts` → Beehiiv
(`POST /v2/publications/{id}/subscriptions`), tagged `utm_source=<source>`,
`utm_medium=daisychain-mail`. Duplicates are no-ops — every sync is safe to re-run.

## Where it runs
- Vercel: https://dc-email-api.vercel.app (Hobby plan → daily is the max cron cadence)
- State: Upstash Redis (sync cursors, alert dedupe flags, Bandcamp OAuth cache)
- Alerts: Resend → playerdave@daisychainsd.com

## Routes
| Path | Auth | Purpose |
|---|---|---|
| `GET /api/cron/bandcamp` | Bearer `CRON_SECRET` | Daily Bandcamp sync (cursor in Redis) |
| `GET /api/cron/shotgun` | Bearer `CRON_SECRET` | Daily Shotgun sync; also checks Laylo silence |
| `POST /api/webhooks/laylo` | HMAC-SHA256 (`LAYLO_WEBHOOK_SECRET`) | Real-time signup ingest |
| `POST /api/internal/backfill` | Bearer `INTERNAL_SECRET` | Manual Bandcamp date-window backfill |
| `POST /api/internal/import-csv` | Bearer `INTERNAL_SECRET` | Manual CSV import |
| `GET /` | none | Static info page (not a health endpoint) |

## How to verify it's healthy
1. **Alerts are the primary signal** — `src/lib/notify.ts` emails on: cron crash,
   ≥5 failures or >10% fail rate in a run, Shotgun token expiry (401), and
   Laylo webhook silence ≥21 days. No email = healthy.
2. Manual check: hit a cron route with the secret and read the JSON
   (`ok`, counts, `nextCursor`, `redisConfigured`, `warning`):
   ```bash
   curl -s https://dc-email-api.vercel.app/api/cron/shotgun -H "Authorization: Bearer $CRON_SECRET"
   ```
3. Beehiiv subscriber count should tick up after events/releases.
4. Vercel dashboard → Logs shows each cron run.

There is **no `/api/health` endpoint yet** — planned as part of the ops
dashboard (Redis ping + last-run cursors + last Laylo webhook age).

## Failure modes & recovery
- **Shotgun token expired**: alert email includes reissue instructions; set new
  `SHOTGUN_API_TOKEN` in Vercel env, redeploy.
- **Laylo silent ≥21 days**: check Laylo webhook config points at
  `/api/webhooks/laylo` and secret matches `LAYLO_WEBHOOK_SECRET`.
- **Redis unconfigured/down**: system degrades gracefully (crons re-fetch from
  initial window, responses include `warning`) — fix Upstash creds.
- **Missed window**: use `POST /api/internal/backfill` (Bandcamp) or
  `scripts/backfill-shotgun.mjs`.

## Env vars (set in Vercel; local: `.env.local`)
`BEEHIIV_API_KEY`, `BEEHIIV_PUBLICATION_ID`, `BANDCAMP_CLIENT_ID`,
`BANDCAMP_CLIENT_SECRET`, `BANDCAMP_BAND_ID` (+ optional
`BANDCAMP_MEMBER_BAND_ID`, `BANDCAMP_INITIAL_START_TIME`,
`BANDCAMP_ACCESS_TOKEN` legacy), `SHOTGUN_API_TOKEN`, `SHOTGUN_ORGANIZER_ID`
(+ optional `SHOTGUN_INITIAL_AFTER`), `LAYLO_WEBHOOK_SECRET`, `CRON_SECRET`,
`INTERNAL_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
`RESEND_API_KEY`, `NOTIFY_EMAIL`.

## Local setup for a new collaborator
```bash
git clone https://github.com/daisychainsd/dc-email-api.git
cd dc-email-api && npm install
cp .env.example .env.local   # get values from Vercel env or PD
npm run dev
curl -s localhost:3000/api/cron/bandcamp -H "Authorization: Bearer $CRON_SECRET"
```

## Known doc drift
README's Laylo auth section describes a shared-secret header — stale. The
running code uses HMAC-SHA256 (`x-laylo-timestamp` + `x-signature-256` over
`timestamp+rawBody`). CLAUDE.md is correct.


## Physical Bandcamp order feed

`GET /api/internal/bandcamp-merch` is a read-only, `INTERNAL_SECRET`-protected feed for Daisy Chain Merch Ops. It calls Bandcamp `merchorders/4/get_orders` with the configured `BANDCAMP_BAND_ID` (and optional `BANDCAMP_MEMBER_BAND_ID`), all dates, shipped and unshipped. It uses the existing OAuth cache and returns physical merchandise only. This route does not subscribe buyers, move the sales-report cursor, mark Bandcamp orders shipped, or send email.

The site calls this feed hourly at minute 25, using its existing `DC_EMAIL_API_INTERNAL_SECRET`. The site owns normalization, Supabase persistence, deduplication and manual fulfillment. Physical Bandcamp orders appear alongside website orders at [Merch Ops](https://www.daisychainsd.com/ops/merch); digital music sales remain outside the shipping queue. Feed failures return 503 without exposing raw provider errors/customer data. Responses are never cached. Run `npm test` for auth, physical endpoint and error-path checks. See [site runbook](https://github.com/daisychainsd/daisychain-site/blob/main/OPERATIONS.md#bandcamp-physical-orders) and [deployment record](https://github.com/daisychainsd/daisychain-site/blob/main/BANDCAMP-ORDERS-2026-09-22.md).
