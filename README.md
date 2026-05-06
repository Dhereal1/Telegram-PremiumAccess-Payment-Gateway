# Telegram Mini App System (Steps 1–3)

This repo contains:
- **Step 1**: Telegram bot (`/start` → inline `web_app` button)
- **Step 2**: React + Vite Mini App UI (`telegram-mini-app/`)
- **Step 3**: Secure backend auth + Neon (Postgres) + Vercel API routes (`api/`)

## Folder structure

```text
.
├─ index.js
├─ server.js
├─ package.json
├─ .env.example
├─ .env.backend.example
└─ .gitignore
```

## Step 1 (Bot)

Create a `.env` file (do not commit it). Example:

```env
BOT_TOKEN=your_bot_token_here
WEB_APP_URL=https://your-vercel-app.vercel.app
```

Notes:
- `WEB_APP_URL` **must be HTTPS** (Telegram requirement for Mini Apps).

## Install

```bash
npm install
```

## Run (Polling)

```bash
node index.js
```

By default, `bot.launch()` uses **long polling**. If you later want **webhooks**, you can switch to webhook mode (commonly used on Vercel/Render) in Step 2+.

## Step 2 (Mini App UI)

- App lives in `telegram-mini-app/` (see `telegram-mini-app/README.md`)

## Step 3 (Backend auth + Neon + Vercel)

### Environment variables

Create a `.env` file for the backend (you can reuse the same `.env` at repo root). Example:

```env
BOT_TOKEN=your_bot_token_here
DATABASE_URL=your_neon_connection_string_here
TELEGRAM_AUTH_MAX_AGE_SECONDS=86400
```

### Neon table

Run this SQL in Neon:

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  telegram_id TEXT UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  wallet_address TEXT,
  payment_status BOOLEAN DEFAULT FALSE,
  expiry_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

If you already created the table, add the wallet column:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address TEXT;
```

Add payment fields:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_status BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_granted BOOLEAN DEFAULT FALSE;
```

Create a processed transaction table (to prevent duplicates):

```sql
CREATE TABLE IF NOT EXISTS processed_transactions (
  tx_hash TEXT PRIMARY KEY,
  telegram_id TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

Create verifier state table (TON pagination checkpointing):

```sql
CREATE TABLE IF NOT EXISTS verifier_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Local dev (Express)

```bash
npm run start:api
```

Endpoints:
- `POST /auth/telegram` body: `{ "initData": "<window.Telegram.WebApp.initData>" }`
- `GET /user/status/:telegram_id`

### Vercel deploy (serverless)

These routes are ready for Vercel (no Express needed in production):
- `POST /api/auth/telegram` (`api/auth/telegram.js`)
- `GET /api/user/status/:telegram_id` (`api/user/status/[telegram_id].js`)

Set Vercel env vars:
- `BOT_TOKEN`
- `DATABASE_URL`
- (optional) `TELEGRAM_AUTH_MAX_AGE_SECONDS`
