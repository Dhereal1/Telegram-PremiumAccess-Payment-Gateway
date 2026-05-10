import pg from 'pg';
import { getWorkerEnv } from './worker-env.mjs';

const { Pool } = pg;
let pool;

// Force Postgres `timestamp without time zone` (OID 1114) to be treated as UTC.
// node-postgres otherwise interprets it as local time, causing expiry comparisons to drift by TZ offset.
pg.types.setTypeParser(1114, (str) => new Date(`${str}Z`));

function poolConfigFromDatabaseUrl(urlStr) {
  const s = String(urlStr || '').trim();
  if (!s) throw new Error('Missing DATABASE_URL');

  const u = new URL(s);
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Error('Invalid DATABASE_URL protocol');

  const user = decodeURIComponent(u.username || '');
  const password = decodeURIComponent(u.password || '');
  const host = u.hostname;
  const port = u.port ? Number(u.port) : undefined;
  const database = u.pathname ? u.pathname.replace(/^\//, '') : undefined;

  const sslmode = String(u.searchParams.get('sslmode') || '').toLowerCase();
  const sslFlag = String(u.searchParams.get('ssl') || '').toLowerCase();
  const sslDisabled = sslmode === 'disable' || sslFlag === '0' || sslFlag === 'false';
  const ssl = sslDisabled ? false : { rejectUnauthorized: false };

  const prevOptions = u.searchParams.get('options') || '';
  const tzOpt = '-c TimeZone=UTC';
  const options = prevOptions.includes('TimeZone=UTC') ? prevOptions : prevOptions ? `${prevOptions} ${tzOpt}` : tzOpt;

  return {
    host,
    port,
    user: user || undefined,
    password: password || undefined,
    database: database || undefined,
    ssl,
    options,
  };
}

export function getDb() {
  if (pool) return pool;
  const env = getWorkerEnv();
  pool = new Pool({
    ...poolConfigFromDatabaseUrl(env.DATABASE_URL),
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  });
  return pool;
}
