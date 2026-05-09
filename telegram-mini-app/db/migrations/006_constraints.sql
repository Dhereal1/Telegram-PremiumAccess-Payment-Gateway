-- Integrity constraints and indexes for SaaS mode.

-- Ensure payment tables reference groups/payment intents where applicable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_intents_group_id_fk') THEN
    ALTER TABLE payment_intents
      ADD CONSTRAINT payment_intents_group_id_fk
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_group_id_fk') THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_group_id_fk
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_payment_intent_id_fk') THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_payment_intent_id_fk
      FOREIGN KEY (payment_intent_id) REFERENCES payment_intents(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_intents_expires_at ON payment_intents(expires_at);
CREATE INDEX IF NOT EXISTS idx_memberships_expiry_date ON memberships(expiry_date);

-- Multi-tenant-only: intents must always be group-scoped.
-- Apply only after you are sure there are no legacy intents with NULL group_id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payment_intents' AND column_name='group_id'
  ) THEN
    -- Best-effort: make it NOT NULL if possible.
    BEGIN
      ALTER TABLE payment_intents ALTER COLUMN group_id SET NOT NULL;
    EXCEPTION WHEN others THEN
      -- ignore (e.g., existing NULL rows). Handle via data migration before enforcing.
    END;
  END IF;
END $$;
