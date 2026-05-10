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
    `SELECT telegram_id, wallet_address, wallet_verified_at
     FROM admins
     WHERE telegram_id=$1`,
    [String(tgUser.id)],
  )
  const admin = r.rows[0] || null
  return res.json({
    ok: true,
    admin: admin
      ? {
          telegram_id: String(admin.telegram_id),
          wallet_address: String(admin.wallet_address),
          wallet_verified_at: admin.wallet_verified_at || null,
          wallet_verified: Boolean(admin.wallet_verified_at),
        }
      : null,
  })
}

