import { getPool } from '../db/index.mjs'
import crypto from 'crypto'

let mode // 'legacy' | 'new'

async function detectMode() {
  if (mode) return mode
  const pool = getPool()
  const cols = await pool.query(
    "select column_name from information_schema.columns where table_schema='public' and table_name='subscription_events'",
  )
  const names = new Set(cols.rows.map((r) => r.column_name))

  // Legacy schema (already in repo): id(uuid), telegram_id, type, metadata, created_at
  if (names.has('telegram_id')) {
    mode = 'legacy'
    return mode
  }

  // New schema (prompt): id(serial), user_id(text), type, metadata, created_at
  mode = 'new'
  return mode
}

export async function logEvent({ userId, type, metadata }) {
  const pool = getPool()
  const m = await detectMode()

  if (m === 'legacy') {
    // Keep compatibility with existing deployments
    await pool.query(
      `INSERT INTO subscription_events (id, telegram_id, type, metadata, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [crypto.randomUUID(), String(userId), String(type), metadata ? JSON.stringify(metadata) : null],
    )
    return
  }

  await pool.query(
    `INSERT INTO subscription_events (user_id, type, metadata, created_at)
     VALUES ($1, $2, $3, NOW())`,
    [String(userId), String(type), metadata ? JSON.stringify(metadata) : null],
  )
}
