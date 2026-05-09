-- Base schema (single-tenant + shared primitives).
-- This migration makes `db/migrate.mjs` sufficient to bootstrap a fresh database.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id TEXT UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  wallet_address TEXT,
  payment_status BOOLEAN DEFAULT FALSE,
  expiry_date TIMESTAMP,
  subscription_status TEXT DEFAULT 'inactive',
  current_period_end TIMESTAMP,
  last_payment_at TIMESTAMP,
  wallet_locked BOOLEAN DEFAULT FALSE,
  access_granted BOOLEAN DEFAULT FALSE,
  last_invite_link TEXT,
  invite_created_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processed_transactions (
  tx_hash TEXT PRIMARY KEY,
  telegram_id TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_intents (
  id UUID PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  expected_amount_ton NUMERIC NOT NULL,
  receiver_address TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  paid_at TIMESTAMP,
  tx_hash TEXT
);

CREATE INDEX IF NOT EXISTS payment_intents_telegram_id_idx ON payment_intents (telegram_id);
CREATE INDEX IF NOT EXISTS payment_intents_status_idx ON payment_intents (status);
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_tx_hash_uq ON payment_intents (tx_hash) WHERE tx_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS payments (
  tx_hash TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  payment_intent_id UUID,
  receiver_address TEXT NOT NULL,
  amount_nano TEXT NOT NULL,
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_payment_intent_id_uq ON payments (payment_intent_id) WHERE payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_telegram_id_idx ON payments (telegram_id);

CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  type TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS subscription_events_telegram_id_idx ON subscription_events (telegram_id);

CREATE TABLE IF NOT EXISTS verifier_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blockchain_cursors (
  id TEXT PRIMARY KEY,
  last_lt BIGINT,
  last_hash TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS failed_jobs (
  id SERIAL PRIMARY KEY,
  job_id TEXT,
  queue_name TEXT,
  payload JSONB,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_actions (
  id SERIAL PRIMARY KEY,
  action TEXT,
  payload JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

