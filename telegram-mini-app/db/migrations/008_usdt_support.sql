-- Add currency support to payment_intents + payments (groundwork for Jetton/USDT).
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'TON';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'TON';

-- Optional: allow setting a USDT price per group (future use).
ALTER TABLE groups ADD COLUMN IF NOT EXISTS price_usdt NUMERIC;

-- Index for currency queries
CREATE INDEX IF NOT EXISTS payment_intents_currency_idx ON payment_intents (currency);

