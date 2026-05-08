import crypto from 'crypto'
import { getPool } from './db.js'

export async function getMembership({ groupId, telegramId }) {
  const pool = getPool()
  const r = await pool.query('SELECT * FROM memberships WHERE group_id=$1 AND telegram_id=$2', [String(groupId), String(telegramId)])
  return r.rows[0] || null
}

export async function ensureMembership({ groupId, telegramId }) {
  const pool = getPool()
  const id = crypto.randomUUID()
  const r = await pool.query(
    `INSERT INTO memberships (id, group_id, telegram_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (group_id, telegram_id) DO UPDATE SET updated_at=NOW()
     RETURNING *`,
    [id, String(groupId), String(telegramId)],
  )
  return r.rows[0]
}

export async function updateInvite({ groupId, telegramId, inviteLink }) {
  const pool = getPool()
  const r = await pool.query(
    `UPDATE memberships
     SET last_invite_link=$3, invite_created_at=NOW(), updated_at=NOW()
     WHERE group_id=$1 AND telegram_id=$2
     RETURNING *`,
    [String(groupId), String(telegramId), String(inviteLink)],
  )
  return r.rows[0] || null
}

