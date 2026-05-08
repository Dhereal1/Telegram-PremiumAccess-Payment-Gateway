import { setCors, readJson } from '../../lib/http.js'
import { parseTelegramUser, verifyTelegramData } from '../../lib/telegram.js'
import { requestAdminPayout } from '../../lib/earnings.js'

function getInitData(req, body) {
  const header = req.headers['x-telegram-init-data']
  const fromHeader = Array.isArray(header) ? header[0] : header
  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader
  if (body?.initData && typeof body.initData === 'string') return body.initData
  const u = new URL(req.url, 'http://localhost')
  const q = u.searchParams.get('initData')
  return q || null
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = await readJson(req)
  const initData = getInitData(req, body)
  if (!initData) return res.status(400).json({ error: 'Missing initData' })

  const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds: 300 })
  if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason })

  const tgUser = parseTelegramUser(initData)
  if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user' })

  const r = await requestAdminPayout({ adminId: String(tgUser.id) })
  return res.json({ ok: true, ...r })
}

