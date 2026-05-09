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

  const groupId = req.query?.groupId
  if (!groupId) return res.status(400).json({ error: 'Missing groupId' })

  const pool = getPool()
  const g = await pool.query('SELECT id, admin_telegram_id FROM groups WHERE id=$1', [String(groupId)])
  if (!g.rows.length) return res.status(404).json({ error: 'Group not found' })
  if (String(g.rows[0].admin_telegram_id) !== String(tgUser.id)) return res.status(403).json({ error: 'Forbidden' })

  const m = await pool.query(
    `SELECT telegram_id, expiry_date, access_granted, created_at
     FROM memberships
     WHERE group_id=$1 AND subscription_status='active'
     ORDER BY created_at DESC
     LIMIT 50`,
    [String(groupId)],
  )

  return res.json(
    m.rows.map((x) => ({
      telegram_id: x.telegram_id,
      expiry_date: x.expiry_date,
      access_granted: Boolean(x.access_granted),
      joined_at: x.created_at,
    })),
  )
}
