# Telegram Mini App (Step 2)

React + Vite Telegram Mini App shell that reads Telegram user info from `initDataUnsafe`.

## Key Telegram integration points

- Telegram SDK script included in `index.html`
- Calls `Telegram.WebApp.ready()`
- Calls `Telegram.WebApp.expand()`
- Reads `Telegram.WebApp.initDataUnsafe.user`

## Run locally

```bash
npm install
npm run dev
```

## Local testing note (HTTPS required)

Telegram Mini Apps require **HTTPS**. For testing inside Telegram:
- Expose your dev server with a tunnel (ngrok / Cloudflare Tunnel), or
- Deploy to Vercel early.

## Vercel (single repo deploy)

Recommended setup: create **one Vercel project** and set **Root Directory** to `telegram-mini-app`.

This deploys:
- Static Mini App frontend (Vite build)
- Serverless API routes under `/api/*` from `telegram-mini-app/api/`

Set Vercel environment variables:
- `BOT_TOKEN`
- `DATABASE_URL`
- `WEB_APP_URL` (set this to your **production** Mini App URL, HTTPS)
- (optional) `TELEGRAM_WEBHOOK_SECRET` (recommended)
- (optional) `TELEGRAM_AUTH_MAX_AGE_SECONDS`
- (optional) `PG_POOL_MAX`, `PG_IDLE_TIMEOUT_MS`, `PG_CONN_TIMEOUT_MS`
- (optional) `CRON_SECRET` (required only if you want to trigger `/api/cron/*` manually)
- `REDIS_URL` (required for queue/workers)

### Neon table update (wallet)

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address TEXT;
```

## Step 5 (TON payment)

Set these Vercel env vars (Preview + Production) to control payments:
- `VITE_TON_RECEIVER_ADDRESS` (merchant TON address)
- `VITE_TON_PRICE_TON` (e.g. `0.1` for testing)

## Step 6 (Verification worker)

DB migrations:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_status BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_granted BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS processed_transactions (
  tx_hash TEXT PRIMARY KEY,
  telegram_id TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS verifier_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

Serverless polling endpoint (trigger via Vercel Cron every 15–30s/min):
- `GET/POST /api/cron/verify-payments` (`telegram-mini-app/api/cron/verify-payments.js`)

Vercel env vars required:
- `TON_RECEIVER_ADDRESS` (same as your merchant address)
- `TON_PRICE_TON` (minimum TON to accept, e.g. `0.1` for testing)
- (optional) `TON_API_URL` (default `https://toncenter.com/api/v2`)
- (optional) `TON_API_KEY` (recommended)
- (optional) `TON_TX_PAGE_LIMIT` (default `50`)
- (optional) `TON_TX_MAX_PAGES` (default `8`)

## Queue + Workers (production path)

This repo now supports an async queue architecture (BullMQ + Redis):
- `payment_verification_queue` processed by `workers/verifyPaymentWorker.mjs`
- TON listener enqueuer: `workers/tonListener.mjs`

Run locally (in separate terminals):

```bash
npm run worker:ton-listener
npm run worker:verify-payments
```

Deploy note:
- Vercel serverless functions are not a good fit for long-running workers.
- Deploy workers as a separate Node service (Fly.io / Render / Railway) with the same env vars.

## Step 7 (Telegram access control)

Requires:
- Bot is admin in the private channel with permission to invite users
- `CHANNEL_ID` (e.g. `-100...`) set in Vercel env

Endpoints:
- `GET/POST /api/cron/grant-access` (`telegram-mini-app/api/cron/grant-access.js`)

Notes:
- Invite links are created with `member_limit=1` and `expire_date` (~1 hour).

## Bot on Vercel (webhook)

This repo includes a serverless Telegram webhook handler:
- `POST /api/telegram/webhook` (`telegram-mini-app/api/telegram/webhook.js`)

After deploying, set the webhook (run locally from repo root):

```bash
node -e "require('dotenv').config(); fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/setWebhook`, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({url: process.env.WEBHOOK_URL})}).then(r=>r.json()).then(console.log)"
```

Recommended: also send a secret token and set it in Vercel env as `TELEGRAM_WEBHOOK_SECRET`.

Where `WEBHOOK_URL` should be your deployed URL + `/api/telegram/webhook`, for example:
`https://<your-prod-domain>/api/telegram/webhook`
