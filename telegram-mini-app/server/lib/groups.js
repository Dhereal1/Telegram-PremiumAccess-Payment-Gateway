import { getPool } from './db.js'

export async function getGroupById(groupId) {
  const pool = getPool()
  const r = await pool.query('SELECT * FROM groups WHERE id=$1', [String(groupId)])
  return r.rows[0] || null
}

export async function listGroupsByAdmin(adminTelegramId) {
  const pool = getPool()
  const r = await pool.query('SELECT * FROM groups WHERE admin_telegram_id=$1 ORDER BY created_at DESC', [String(adminTelegramId)])
  return r.rows
}

export async function upsertAdminWallet({ adminTelegramId, walletAddress }) {
  const pool = getPool()
  const r = await pool.query(
    `INSERT INTO admins (telegram_id, wallet_address)
     VALUES ($1,$2)
     ON CONFLICT (telegram_id) DO UPDATE SET wallet_address=EXCLUDED.wallet_address
     RETURNING *`,
    [String(adminTelegramId), String(walletAddress)],
  )
  return r.rows[0]
}

export async function createGroup({
  id,
  telegramChatId,
  adminTelegramId,
  name,
  priceTon,
  durationDays,
}) {
  const pool = getPool()
  await pool.query(
    `INSERT INTO groups (id, telegram_chat_id, admin_telegram_id, name, price_ton, duration_days)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [String(id), String(telegramChatId), String(adminTelegramId), String(name), String(priceTon), Number(durationDays)],
  )
  return getGroupById(id)
}

