import pg from 'pg';

const { Pool } = pg;

let pool;

export function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) {
    throw new Error('Missing DATABASE_URL env var');
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Serverless-friendly defaults (avoid too many concurrent connections)
    max: Number(process.env.PG_POOL_MAX || '1'),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || '10000'),
    connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || '10000'),
    ssl: { rejectUnauthorized: false },
  });

  return pool;
}
