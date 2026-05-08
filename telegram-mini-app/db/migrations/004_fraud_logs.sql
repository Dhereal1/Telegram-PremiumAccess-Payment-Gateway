-- Fraud / abuse logging (best-effort audit trail)

CREATE TABLE IF NOT EXISTS fraud_logs (
  id UUID PRIMARY KEY,
  telegram_id TEXT,
  group_id UUID,
  payment_intent_id UUID,
  tx_hash TEXT,
  reason TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fraud_logs_tx_hash_idx ON fraud_logs(tx_hash);
CREATE INDEX IF NOT EXISTS fraud_logs_telegram_idx ON fraud_logs(telegram_id);
CREATE INDEX IF NOT EXISTS fraud_logs_created_idx ON fraud_logs(created_at);

