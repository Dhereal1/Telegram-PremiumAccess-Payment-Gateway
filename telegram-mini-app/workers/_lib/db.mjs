import pg from 'pg';
import { getWorkerEnv } from './worker-env.mjs';

const { Pool } = pg;
let pool;

export function getDb() {
  if (pool) return pool;
  const env = getWorkerEnv();
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  });
  return pool;
}

