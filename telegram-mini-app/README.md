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
- (optional) `TELEGRAM_AUTH_MAX_AGE_SECONDS`

### Neon table update (wallet)

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address TEXT;
```

## Step 5 (TON payment)

Set these Vercel env vars (Preview + Production) to control payments:
- `VITE_TON_RECEIVER_ADDRESS` (merchant TON address)
- `VITE_TON_PRICE_TON` (e.g. `0.1` for testing)
