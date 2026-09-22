# Daisy Chain Mail

Node/TypeScript subscriber sync for [Vercel](https://vercel.com): polls **Bandcamp** sales, accepts **Laylo** webhooks, and subscribes emails to **Beehiiv**. Optional **CSV import** for Shotgun or other exports.

## Setup

1. **Install**

   ```bash
   npm install
   ```

2. **Environment variables**

   Copy [`.env.example`](.env.example) to `.env.local` and fill in values.

   | Variable | Purpose |
   |---|---|
   | `BEEHIIV_API_KEY` | Beehiiv API key (Settings → API) |
   | `BEEHIIV_PUBLICATION_ID` | Publication UUID |
   | `BANDCAMP_CLIENT_ID`, `BANDCAMP_CLIENT_SECRET` | From Bandcamp **API Access** — the app exchanges these for access tokens automatically (recommended) |
   | `BANDCAMP_ACCESS_TOKEN` | Optional legacy static token; omit if using Client ID + Secret |
   | `BANDCAMP_BAND_ID` | Numeric band/label id ([my_bands](https://bandcamp.com/developer/account)) — not the same as Client ID |
   | `BANDCAMP_MEMBER_BAND_ID` | Optional; filter when calling as a label |
   | `BANDCAMP_INITIAL_START_TIME` | First poll window start if no Redis cursor (UTC) |
   | `CRON_SECRET` | Protects `GET /api/cron/bandcamp` (Vercel Cron sends `Authorization: Bearer …`) |
   | `INTERNAL_SECRET` | Protects `POST /api/internal/backfill` and `POST /api/internal/import-csv` |
   | `LAYLO_WEBHOOK_SECRET` | Laylo must send `x-webhook-secret` or `Authorization: Bearer` with this value |
   | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis (Vercel Marketplace) — **recommended** so Bandcamp cursor survives deploys |

3. **Redis (Upstash)**

   In the Vercel project: [Marketplace](https://vercel.com/marketplace?category=storage) → add **Redis** (Upstash). Link it to the project so `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set. Redis stores the Bandcamp **sales cursor** and **caches OAuth tokens** so Client ID + Secret do not hit `oauth_token` on every request. Without Redis, OAuth still works using an in-memory cache per server instance (less ideal).

4. **Cron**

   [`vercel.json`](vercel.json) schedules `GET /api/cron/bandcamp` **once daily** at **15:00 UTC** (Vercel **Hobby** allows at most one cron run per day). Set `CRON_SECRET` in Vercel; [securing cron jobs](https://vercel.com/docs/cron-jobs#securing-cron-jobs) uses the same `Authorization` header. On **Pro**, you can change the schedule to hourly if you prefer.

5. **Laylo**

   Point Laylo’s webhook URL to `https://<your-domain>/api/webhooks/laylo` and configure a shared secret in `LAYLO_WEBHOOK_SECRET`. The handler expects JSON with an email at `email`, `user.email`, or `data.email` (extend [`src/lib/extractEmail.ts`](src/lib/extractEmail.ts) if your payload differs).

## One-time Bandcamp backfill

```bash
curl -X POST "https://<your-domain>/api/internal/backfill" \
  -H "Authorization: Bearer $INTERNAL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"start_time":"2015-01-01 00:00:00","end_time":"2026-03-31 23:59:59","advance_cursor":true}'
```

`advance_cursor: true` (default) stores `end_time` in Redis so the scheduled cron continues after the backfill.

## Shotgun / CSV import

Export a CSV with an `email` column (header row optional). Send the raw file body:

```bash
curl -X POST "https://<your-domain>/api/internal/import-csv?source=shotgun" \
  -H "Authorization: Bearer $INTERNAL_SECRET" \
  -H "Content-Type: text/csv" \
  --data-binary @shotgun-fans.csv
```

## Local dev

```bash
npm run dev
```

Trigger cron locally:

```bash
curl -s "http://localhost:3000/api/cron/bandcamp" -H "Authorization: Bearer $CRON_SECRET"
```

## Bandcamp auth

Set **`BANDCAMP_CLIENT_ID`** and **`BANDCAMP_CLIENT_SECRET`** in Vercel (from Bandcamp **API Access**). The app calls `oauth_token` with `grant_type=client_credentials`, caches the access token (Redis if configured), and refreshes when it expires. You do **not** need to paste a separate `BANDCAMP_ACCESS_TOKEN` unless you prefer the legacy path.


## Physical Bandcamp order feed

`GET /api/internal/bandcamp-merch` is a read-only, `INTERNAL_SECRET`-protected feed for Daisy Chain Merch Ops. It calls Bandcamp `merchorders/4/get_orders` with the configured `BANDCAMP_BAND_ID` (and optional `BANDCAMP_MEMBER_BAND_ID`), all dates, shipped and unshipped. It uses the existing OAuth cache and returns physical merchandise only. This route does not subscribe buyers, move the sales-report cursor, mark Bandcamp orders shipped, or send email.

The site calls this feed hourly at minute 25, using its existing `DC_EMAIL_API_INTERNAL_SECRET`. The site owns normalization, Supabase persistence, deduplication and manual fulfillment. Physical Bandcamp orders appear alongside website orders at [Merch Ops](https://www.daisychainsd.com/ops/merch); digital music sales remain outside the shipping queue. Feed failures return 503 without exposing raw provider errors/customer data. Responses are never cached. Run `npm test` for auth, physical endpoint and error-path checks. See [site runbook](https://github.com/daisychainsd/daisychain-site/blob/main/OPERATIONS.md#bandcamp-physical-orders) and [deployment record](https://github.com/daisychainsd/daisychain-site/blob/main/BANDCAMP-ORDERS-2026-09-22.md).
