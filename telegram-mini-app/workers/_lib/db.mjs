import pg from 'pg';
import { getWorkerEnv } from './worker-env.mjs';

const { Pool } = pg;
let pool;

// Force Postgres `timestamp without time zone` (OID 1114) to be treated as UTC.
// node-postgres otherwise interprets it as local time, causing expiry comparisons to drift by TZ offset.
pg.types.setTypeParser(1114, (str) => new Date(`${str}Z`));

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
  pool.on('connect', (client) => {
    client.query(`SET TIME ZONE 'UTC'`).catch(() => {});
  });
  return pool;
}
