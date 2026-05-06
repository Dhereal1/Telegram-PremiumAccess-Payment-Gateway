require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Missing DATABASE_URL');

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
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
      created_at TIMESTAMP DEFAULT NOW()
    );`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address TEXT;`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_status BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMP;`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS access_granted BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive';`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP;`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMP;`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_locked BOOLEAN DEFAULT FALSE;`,
    `CREATE TABLE IF NOT EXISTS processed_transactions (
      tx_hash TEXT PRIMARY KEY,
      telegram_id TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );`,
    `CREATE TABLE IF NOT EXISTS payment_intents (
      id UUID PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      expected_amount_ton NUMERIC NOT NULL,
      receiver_address TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL,
      paid_at TIMESTAMP,
      tx_hash TEXT
    );`,
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_intents_id_unique') THEN
         ALTER TABLE payment_intents ADD CONSTRAINT payment_intents_id_unique UNIQUE (id);
       END IF;
     END $$;`,
    `CREATE INDEX IF NOT EXISTS payment_intents_telegram_id_idx ON payment_intents (telegram_id);`,
    `CREATE INDEX IF NOT EXISTS payment_intents_status_idx ON payment_intents (status);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_tx_hash_uq ON payment_intents (tx_hash) WHERE tx_hash IS NOT NULL;`,
    `CREATE TABLE IF NOT EXISTS payments (
      tx_hash TEXT PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      payment_intent_id UUID,
      receiver_address TEXT NOT NULL,
      amount_nano TEXT NOT NULL,
      comment TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );`,
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_tx_hash_unique') THEN
         ALTER TABLE payments ADD CONSTRAINT payments_tx_hash_unique UNIQUE (tx_hash);
       END IF;
     END $$;`,
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_payment_intent_id_unique') THEN
         ALTER TABLE payments ADD CONSTRAINT payments_payment_intent_id_unique UNIQUE (payment_intent_id);
       END IF;
     END $$;`,
    `CREATE INDEX IF NOT EXISTS payments_telegram_id_idx ON payments (telegram_id);`,
    `CREATE TABLE IF NOT EXISTS subscription_events (
      id UUID PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      type TEXT NOT NULL,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS subscription_events_telegram_id_idx ON subscription_events (telegram_id);`,
    `CREATE TABLE IF NOT EXISTS verifier_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    );`,
    `CREATE TABLE IF NOT EXISTS blockchain_cursors (
      id TEXT PRIMARY KEY,
      last_lt BIGINT,
      last_hash TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );`,
    `CREATE TABLE IF NOT EXISTS failed_jobs (
      id SERIAL PRIMARY KEY,
      job_id TEXT,
      queue_name TEXT,
      payload JSONB,
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );`,
  ];

  try {
    await pool.query('BEGIN');
    for (const sql of statements) await pool.query(sql);
    await pool.query('COMMIT');

    const cols = await pool.query(
      "select column_name from information_schema.columns where table_schema='public' and table_name='users' order by ordinal_position",
    );
    console.log('users columns:', cols.rows.map((r) => r.column_name).join(', '));
  } catch (e) {
    try {
      await pool.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw e;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('migration failed:', e.message || e);
  process.exitCode = 1;
});
