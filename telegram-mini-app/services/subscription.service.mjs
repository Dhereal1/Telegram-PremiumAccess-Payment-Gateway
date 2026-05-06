import { getPool } from '../db/index.mjs'

export async function markAccessGranted(userId) {
  const pool = getPool()
  await pool.query('UPDATE users SET access_granted = true WHERE id = $1', [userId])
}

export async function markAccessGrantedIfNotExists(userId) {
  const pool = getPool()
  const res = await pool.query(
    `
    UPDATE users
    SET access_granted = true
    WHERE id = $1
      AND access_granted = false
    RETURNING *
  `,
    [userId]
  )
  return res.rows[0] || null
}

export async function unmarkAccessGranted(userId) {
  const pool = getPool()
  await pool.query('UPDATE users SET access_granted = false WHERE id = $1', [userId])
}

export async function setInviteInfo({ userId, inviteLink }) {
  const pool = getPool()
  await pool.query(
    `UPDATE users
     SET last_invite_link = $2,
         invite_created_at = NOW()
     WHERE id = $1`,
    [userId, inviteLink],
  )
}
