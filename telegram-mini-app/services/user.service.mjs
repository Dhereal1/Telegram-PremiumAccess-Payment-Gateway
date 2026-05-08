import { getPool } from '../db/index.mjs'

export async function getUserById(userId) {
  const pool = getPool()
  const res = await pool.query('SELECT * FROM users WHERE id = $1', [userId])
  return res.rows[0] || null
}

export async function getUserByTelegramId(telegramId) {
  const pool = getPool()
  const res = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [String(telegramId)])
  return res.rows[0] || null
}

export async function getMembershipById(membershipId) {
  const pool = getPool()
  const res = await pool.query('SELECT * FROM memberships WHERE id = $1', [String(membershipId)])
  return res.rows[0] || null
}
