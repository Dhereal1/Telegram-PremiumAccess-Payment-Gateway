import pg from 'pg'

const { Pool } = pg
let pool

// Force Postgres `timestamp without time zone` (OID 1114) to be treated as UTC.
// node-postgres otherwise interprets it as local time, causing expiry comparisons to drift by TZ offset.
pg.types.setTypeParser(1114, (str) => new Date(`${str}Z`))

function poolConfigFromDatabaseUrl(urlStr, { rejectUnauthorized }) {
  const s = String(urlStr || '').trim()
  if (!s) throw new Error('Missing DATABASE_URL')

  const u = new URL(s)
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Error('Invalid DATABASE_URL protocol')

  const user = decodeURIComponent(u.username || '')
  const password = decodeURIComponent(u.password || '')
  const host = u.hostname
  const port = u.port ? Number(u.port) : undefined
  const database = u.pathname ? u.pathname.replace(/^\//, '') : undefined

  // Respect explicit disable flags if present (useful for local dev DBs).
  const sslmode = String(u.searchParams.get('sslmode') || '').toLowerCase()
  const sslFlag = String(u.searchParams.get('ssl') || '').toLowerCase()
  const sslDisabled = sslmode === 'disable' || sslFlag === '0' || sslFlag === 'false'
  const ssl = sslDisabled ? false : { rejectUnauthorized }

  // Force server TZ to UTC (avoids app-side drift + removes need for a connect hook query).
  const prevOptions = u.searchParams.get('options') || ''
  const tzOpt = '-c TimeZone=UTC'
  const options = prevOptions.includes('TimeZone=UTC') ? prevOptions : prevOptions ? `${prevOptions} ${tzOpt}` : tzOpt

  return {
    host,
    port,
    user: user || undefined,
    password: password || undefined,
    database: database || undefined,
    ssl,
    options,
  }
}

export function getPool() {
  if (pool) return pool
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL')

  const rejectUnauthorized = String(process.env.PG_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true'

  pool = new Pool({
    ...poolConfigFromDatabaseUrl(process.env.DATABASE_URL, { rejectUnauthorized }),
    max: Number(process.env.PG_POOL_MAX || '2'),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || '10000'),
    connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || '10000')
  })
  return pool
}
