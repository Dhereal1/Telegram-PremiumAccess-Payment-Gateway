-- Telegram bot onboarding sessions (state machine)
-- Stored in DB to survive restarts and allow stateless bot runtimes.

CREATE TABLE IF NOT EXISTS onboarding_sessions (
  admin_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  step TEXT NOT NULL, -- awaiting_setup|awaiting_price|awaiting_duration|awaiting_name|awaiting_wallet|complete
  collected_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id, telegram_chat_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_chat ON onboarding_sessions(telegram_chat_id);

