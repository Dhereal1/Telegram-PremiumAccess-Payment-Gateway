-- Multi-tenant SaaS layer
-- - One admin (telegram_id) can own multiple groups
-- - One user (telegram_id) can subscribe to multiple groups via memberships

CREATE TABLE IF NOT EXISTS admins (
  telegram_id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY,
  telegram_chat_id TEXT UNIQUE NOT NULL,
  admin_telegram_id TEXT NOT NULL REFERENCES admins(telegram_id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  price_ton NUMERIC NOT NULL,
  duration_days INT NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_groups_admin ON groups(admin_telegram_id);

-- Users are global identity (existing table), memberships are per-group subscription state
CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  telegram_id TEXT NOT NULL,
  subscription_status TEXT NOT NULL DEFAULT 'inactive', -- inactive|active|expired
  current_period_end TIMESTAMP,
  last_payment_at TIMESTAMP,
  payment_status BOOLEAN NOT NULL DEFAULT FALSE,
  expiry_date TIMESTAMP,
  access_granted BOOLEAN NOT NULL DEFAULT FALSE,
  last_invite_link TEXT,
  invite_created_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (group_id, telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_telegram ON memberships(telegram_id);
CREATE INDEX IF NOT EXISTS idx_memberships_group ON memberships(group_id);

-- Add group_id columns to payment tables for auditability/matching
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS group_id UUID;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS group_id UUID;

CREATE INDEX IF NOT EXISTS idx_payment_intents_group ON payment_intents(group_id);
CREATE INDEX IF NOT EXISTS idx_payments_group ON payments(group_id);

