import { getPool } from '../_lib/db.js'
import { setCors, readJson } from '../_lib/http.js'
import { verifyTelegramData, parseTelegramUser } from '../_lib/telegram.js'
import { parseJson, TelegramInitDataSchema } from '../_lib/validation.js'
import { getQueues } from '../_lib/queue.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let body
  try {
    body = await readJson(req)
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  const { initData } = parseJson(body, TelegramInitDataSchema)
  const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds: 300 })
  if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason })

  const tgUser = parseTelegramUser(initData)
  if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user in initData' })

  const pool = getPool()
  const u = await pool.query('SELECT id, telegram_id, payment_status FROM users WHERE telegram_id=$1', [String(tgUser.id)])
  if (!u.rows.length) return res.status(404).json({ error: 'User not found' })
  if (!u.rows[0].payment_status) return res.status(403).json({ error: 'Not paid' })

  const userId = u.rows[0].id
  const { accessGrantQueue } = getQueues()
  await accessGrantQueue.add(
    'regenerate-invite',
    { userId, telegramId: String(tgUser.id), forceRegenerate: true },
    { jobId: `regen:${userId}:${Date.now()}` },
  )

  return res.json({ ok: true, enqueued: true })
}
