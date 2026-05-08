-- Platform fee + admin earnings tracking

CREATE TABLE IF NOT EXISTS earnings (
  id UUID PRIMARY KEY,
  admin_id TEXT NOT NULL,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  payment_id TEXT NOT NULL REFERENCES payments(tx_hash) ON DELETE RESTRICT,
  total_amount NUMERIC NOT NULL,
  platform_fee NUMERIC NOT NULL,
  admin_amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|processing|paid
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS earnings_payment_id_uq ON earnings(payment_id);
CREATE INDEX IF NOT EXISTS earnings_admin_status_idx ON earnings(admin_id, status);
CREATE INDEX IF NOT EXISTS earnings_group_idx ON earnings(group_id);

