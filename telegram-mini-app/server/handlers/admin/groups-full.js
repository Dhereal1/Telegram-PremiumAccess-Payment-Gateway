import { setCors } from '../../lib/http.js'
import { getPool } from '../../lib/db.js'
import { parseTelegramUser, verifyTelegramData } from '../../lib/telegram.js'

function getInitData(req) {
  const header = req.headers['x-telegram-init-data']
  const fromHeader = Array.isArray(header) ? header[0] : header
  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader
  const u = new URL(req.url, 'http://localhost')
  const q = u.searchParams.get('initData')
  return q || null
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const initData = getInitData(req)
  if (!initData) return res.status(400).json({ error: 'Missing initData' })

  const maxAgeSeconds = Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || '300')
  const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds })
  if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason })

  const tgUser = parseTelegramUser(initData)
  if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user' })

  const pool = getPool()
  const r = await pool.query(
    `SELECT
       g.id,
       g.name,
       g.telegram_chat_id,
       g.price_ton,
       g.duration_days,
       g.created_at,
       COALESCE(COUNT(m.id) FILTER (WHERE m.subscription_status='active'), 0) AS member_count
     FROM groups g
     LEFT JOIN memberships m ON m.group_id = g.id
     WHERE g.admin_telegram_id = $1
     GROUP BY g.id
     ORDER BY g.created_at DESC`,
    [String(tgUser.id)],
  )

  return res.json(
    r.rows.map((x) => ({
      id: x.id,
      name: x.name,
      telegram_chat_id: x.telegram_chat_id,
      price_ton: Number(x.price_ton),
      duration_days: Number(x.duration_days),
      created_at: x.created_at,
      member_count: Number(x.member_count || 0),
    })),
  )
}
