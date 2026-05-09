import pg from 'pg'

const { Pool } = pg
let pool

// Force Postgres `timestamp without time zone` (OID 1114) to be treated as UTC.
// node-postgres otherwise interprets it as local time, causing expiry comparisons to drift by TZ offset.
pg.types.setTypeParser(1114, (str) => new Date(`${str}Z`))

function normalizeDatabaseUrl(urlStr) {
  const s = String(urlStr || '').trim()
  if (!s) return s
  // Avoid pg-connection-string sslmode warnings by stripping sslmode from URL query.
  // SSL behavior is controlled explicitly via the `ssl` Pool option below.
  try {
    const u = new URL(s)
    if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return s
    u.searchParams.delete('sslmode')
    u.searchParams.delete('ssl')
    return u.toString()
  } catch {
    return s
  }
}

export function getPool() {
  if (pool) return pool
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL')

  const rejectUnauthorized = String(process.env.PG_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true'

  pool = new Pool({
    connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL),
    ssl: { rejectUnauthorized },
    max: Number(process.env.PG_POOL_MAX || '2'),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || '10000'),
    connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || '10000')
  })
  pool.on('connect', (client) => {
    client.query(`SET TIME ZONE 'UTC'`).catch(() => {})
  })
  return pool
}
