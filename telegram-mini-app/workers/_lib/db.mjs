import pg from 'pg';
import { getWorkerEnv } from './worker-env.mjs';

const { Pool } = pg;
let pool;

// Force Postgres `timestamp without time zone` (OID 1114) to be treated as UTC.
// node-postgres otherwise interprets it as local time, causing expiry comparisons to drift by TZ offset.
pg.types.setTypeParser(1114, (str) => new Date(`${str}Z`));

function normalizeDatabaseUrl(urlStr) {
  const s = String(urlStr || '').trim();
  if (!s) return s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return s;
    const prev = u.searchParams.get('options') || '';
    const tzOpt = '-c TimeZone=UTC';
    if (!prev.includes('TimeZone=UTC')) {
      u.searchParams.set('options', prev ? `${prev} ${tzOpt}` : tzOpt);
    }
    return u.toString();
  } catch {
    return s;
  }
}

export function getDb() {
  if (pool) return pool;
  const env = getWorkerEnv();
  pool = new Pool({
    connectionString: normalizeDatabaseUrl(env.DATABASE_URL),
    ssl: { rejectUnauthorized: false },
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  });
  return pool;
}
