ALTER TABLE memberships
ADD COLUMN IF NOT EXISTS expiry_warning_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_memberships_expiry_warning
ON memberships(expiry_date, expiry_warning_sent_at)
WHERE subscription_status = 'active';

