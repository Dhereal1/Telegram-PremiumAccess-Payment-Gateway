import { setCors, readJson } from '../../lib/http.js'
import { getPool } from '../../lib/db.js'
import { parseTelegramUser, verifyTelegramData } from '../../lib/telegram.js'
import { parseJson } from '../../lib/validation.js'
import { z } from 'zod'
import { sendMessage } from '../../../services/telegram.service.mjs'

const BodySchema = z.object({
  initData: z.string().min(1),
  name: z.string().min(1).max(120),
  price_ton: z.number().positive(),
  duration_days: z.number().int().positive(),
})

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })

  const groupId = req.query?.groupId
  if (!groupId) return res.status(400).json({ error: 'Missing groupId' })

  let body
  try {
    body = await readJson(req)
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  const parsed = parseJson(body, BodySchema)
  const initData = parsed.initData

  const maxAgeSeconds = Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || '300')
  const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds })
  if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason })

  const tgUser = parseTelegramUser(initData)
  if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user' })

  const pool = getPool()
  const g = await pool.query('SELECT id, admin_telegram_id FROM groups WHERE id=$1', [String(groupId)])
  if (!g.rows.length) return res.status(404).json({ error: 'Group not found' })
  if (String(g.rows[0].admin_telegram_id) !== String(tgUser.id)) return res.status(403).json({ error: 'Forbidden' })

  const updated = await pool.query(
    `UPDATE groups
     SET name=$2, price_ton=$3, duration_days=$4
     WHERE id=$1
     RETURNING id, name, telegram_chat_id, price_ton, duration_days, created_at, is_active`,
    [String(groupId), parsed.name.trim(), String(parsed.price_ton), Number(parsed.duration_days)],
  )

  const row = updated.rows[0]

  // Best-effort confirmation DM (does not block response).
  try {
    await sendMessage(
      String(tgUser.id),
      `✅ Group settings updated!\n\nNew price: ${row.price_ton} TON / ${row.duration_days} days\nExisting subscribers are not affected.`,
    ).catch(() => {})
  } catch {
    // ignore
  }

  res.setHeader('Cache-Control', 'no-store')
  return res.json({
    id: row.id,
    name: row.name,
    telegram_chat_id: row.telegram_chat_id,
    price_ton: Number(row.price_ton),
    duration_days: Number(row.duration_days),
    created_at: row.created_at,
    is_active: Boolean(row.is_active),
  })
}

