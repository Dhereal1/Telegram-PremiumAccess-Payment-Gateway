import { setCors } from '../../lib/http.js'
import { getPool } from '../../lib/db.js'
import { parseTelegramUser, verifyTelegramData } from '../../lib/telegram.js'

function fetchWithTimeout(url, { timeoutMs, ...opts } = {}) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs || 3000)
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(t))
}

let cachedBotId = null
async function getBotId(botToken) {
  if (cachedBotId) return cachedBotId
  const url = `https://api.telegram.org/bot${botToken}/getMe`
  const res = await fetchWithTimeout(url, { timeoutMs: 3000, method: 'GET' })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.description || 'getMe failed')
  cachedBotId = String(data.result.id)
  return cachedBotId
}

async function getChat({ botToken, chatId }) {
  const url = `https://api.telegram.org/bot${botToken}/getChat`
  const res = await fetchWithTimeout(url, {
    timeoutMs: 3000,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.description || 'getChat failed')
  return data.result
}

async function getChatMember({ botToken, chatId, userId }) {
  const url = `https://api.telegram.org/bot${botToken}/getChatMember`
  const res = await fetchWithTimeout(url, {
    timeoutMs: 3000,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, user_id: Number(userId) }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.description || 'getChatMember failed')
  return data.result
}

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

  const botToken = String(process.env.BOT_TOKEN || '').trim()
  if (!botToken) return res.status(500).json({ error: 'Missing BOT_TOKEN' })

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

  const groups = r.rows.map((x) => ({
    id: x.id,
    name: x.name,
    telegram_chat_id: x.telegram_chat_id,
    price_ton: Number(x.price_ton),
    duration_days: Number(x.duration_days),
    created_at: x.created_at,
    member_count: Number(x.member_count || 0),
    telegram_status: x.telegram_chat_id ? 'unknown' : null,
  }))

  let botId = null
  try {
    botId = await getBotId(botToken)
  } catch {
    // If bot id cannot be fetched, treat checks as inaccessible to fail safe.
    botId = null
  }

  const checks = await Promise.allSettled(
    groups.map(async (g) => {
      if (!g.telegram_chat_id) return { id: g.id, status: null }
      try {
        await getChat({ botToken, chatId: g.telegram_chat_id })
      } catch {
        await pool.query('UPDATE groups SET is_active=FALSE WHERE id=$1', [String(g.id)]).catch(() => {})
        return { id: g.id, status: 'inaccessible' }
      }

      if (!botId) return { id: g.id, status: 'ok' }
      try {
        const member = await getChatMember({ botToken, chatId: g.telegram_chat_id, userId: botId })
        const s = String(member?.status || '')
        const isAdmin = s === 'administrator' || s === 'creator'
        return { id: g.id, status: isAdmin ? 'ok' : 'bot_not_admin' }
      } catch {
        return { id: g.id, status: 'ok' }
      }
    }),
  )

  const byId = new Map()
  for (const c of checks) {
    if (c.status === 'fulfilled') byId.set(String(c.value.id), c.value.status)
  }
  for (const g of groups) {
    if (g.telegram_chat_id) g.telegram_status = byId.get(String(g.id)) || 'ok'
  }

  res.setHeader('Cache-Control', 'no-store')
  return res.json(groups)
}
