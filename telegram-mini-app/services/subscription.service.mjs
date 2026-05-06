import { getPool } from '../db/index.mjs'

export async function markAccessGranted(userId) {
  const pool = getPool()
  await pool.query('UPDATE users SET access_granted = true WHERE id = $1', [userId])
}

