import { getPool } from './db.js'
import { toFriendlyAddress } from './toncenter.js'

export async function getAdminByTelegramId(adminTelegramId) {
  const pool = getPool()
  const r = await pool.query('SELECT * FROM admins WHERE telegram_id=$1', [String(adminTelegramId)])
  return r.rows[0] || null
}

export async function getGroupByTelegramChatId(telegramChatId) {
  const pool = getPool()
  const r = await pool.query('SELECT * FROM groups WHERE telegram_chat_id=$1', [String(telegramChatId)])
  return r.rows[0] || null
}

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
  const storedWallet = toFriendlyAddress(String(walletAddress)) || String(walletAddress)
  const r = await pool.query(
    `INSERT INTO admins (telegram_id, wallet_address)
     VALUES ($1,$2)
     ON CONFLICT (telegram_id) DO UPDATE SET wallet_address=EXCLUDED.wallet_address, wallet_verified_at=NULL
     RETURNING *`,
    [String(adminTelegramId), storedWallet],
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

export async function createGroupIfNotExists({
  id,
  telegramChatId,
  adminTelegramId,
  name,
  priceTon,
  durationDays,
}) {
  const pool = getPool()
  const r = await pool.query(
    `INSERT INTO groups (id, telegram_chat_id, admin_telegram_id, name, price_ton, duration_days)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (telegram_chat_id) DO NOTHING
     RETURNING *`,
    [String(id), String(telegramChatId), String(adminTelegramId), String(name), String(priceTon), Number(durationDays)],
  )
  if (r.rows[0]) return r.rows[0]
  return getGroupByTelegramChatId(telegramChatId)
}
