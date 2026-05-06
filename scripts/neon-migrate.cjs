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
      created_at TIMESTAMP DEFAULT NOW()
    );`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address TEXT;`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_status BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMP;`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS access_granted BOOLEAN DEFAULT FALSE;`,
    `CREATE TABLE IF NOT EXISTS processed_transactions (
      tx_hash TEXT PRIMARY KEY,
      telegram_id TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );`,
    `CREATE TABLE IF NOT EXISTS verifier_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
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
