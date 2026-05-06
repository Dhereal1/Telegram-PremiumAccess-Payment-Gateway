import pg from 'pg'

const { Pool } = pg
let pool

export function getPool() {
  if (pool) return pool
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL')

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000
  })
  return pool
}

