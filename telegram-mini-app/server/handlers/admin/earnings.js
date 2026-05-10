import { setCors } from '../../lib/http.js'
import { parseTelegramUser, verifyTelegramData } from '../../lib/telegram.js'
import { getAdminEarnings } from '../../lib/earnings.js'

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

  const result = await getAdminEarnings({ adminId: String(tgUser.id), limit: 50 })
  res.setHeader('Cache-Control', 'no-store')
  return res.json(result)
}
