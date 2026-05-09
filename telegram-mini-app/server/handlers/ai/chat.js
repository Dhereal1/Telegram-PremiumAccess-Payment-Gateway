import { setCors, readJson } from '../../lib/http.js'
import { verifyTelegramData, parseTelegramUser } from '../../lib/telegram.js'
import { rateLimit } from '../../lib/rate-limit.js'
import { getPool } from '../../lib/db.js'
import { chatComplete } from '../../lib/groq.js'
import { getLogger } from '../../lib/log.js'

const log = getLogger()

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

  const initData = body?.initData
  const groupId = body?.groupId
  const message = String(body?.message || '').trim()

  if (!message) return res.status(400).json({ error: 'Missing message' })
  if (message.length > 500) return res.status(400).json({ error: 'Message too long (max 500 chars)' })
  if (!groupId) return res.status(400).json({ error: 'Missing groupId' })

  const maxAgeSeconds = Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || '300')
  const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds })
  if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason })

  const tgUser = parseTelegramUser(initData)
  if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user in initData' })

  // Rate limit: 10 requests per user per minute.
  try {
    const rl = await rateLimit({ key: `ai_chat:${String(tgUser.id)}`, limit: 10, windowSeconds: 60 })
    if (!rl.ok) return res.status(429).json({ error: 'Too many requests. Please slow down.' })
  } catch {
    // If Redis unavailable, fail open (AI endpoint is non-critical).
  }

  const pool = getPool()
  const g = await pool.query('SELECT id, name FROM groups WHERE id=$1 AND is_active=TRUE', [String(groupId)])
  const group = g.rows[0]
  if (!group) return res.status(404).json({ error: 'Group not found' })

  let reply = null
  try {
    reply = await chatComplete({
      system: `You are a helpful assistant for the "${group.name}" Telegram community.\nAnswer questions about the group, subscriptions, and TON payments.\nBe concise (max 3 sentences). Do not discuss other topics.`,
      user: message,
      maxTokens: 200,
    })
  } catch (e) {
    log.warn({ err: String(e?.message || e) }, 'ai_chat_failed')
  }
  reply = reply || 'AI assistant is not available right now.'

  return res.json({ reply })
}
