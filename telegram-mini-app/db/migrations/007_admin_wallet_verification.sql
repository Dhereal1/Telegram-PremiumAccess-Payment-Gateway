-- Admin wallet proof-of-control (multi-tenant SaaS)

ALTER TABLE admins
ADD COLUMN IF NOT EXISTS wallet_verified_at TIMESTAMPTZ;

ALTER TABLE admins
ADD COLUMN IF NOT EXISTS wallet_verification_nonce TEXT;

ALTER TABLE admins
ADD COLUMN IF NOT EXISTS wallet_verification_requested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_admins_wallet_verified
ON admins(wallet_verified_at);

