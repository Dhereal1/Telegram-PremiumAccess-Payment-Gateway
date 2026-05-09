import crypto from 'crypto'
import fetch from 'node-fetch'
import { setCors, readJson } from '../../lib/http.js'
import { parseTelegramUser, verifyTelegramData } from '../../lib/telegram.js'
import { parseJson } from '../../lib/validation.js'
import { z } from 'zod'
import { createGroup, getAdminByTelegramId } from '../../lib/groups.js'

const BodySchema = z.object({
  initData: z.string().min(1),
  telegram_chat_id: z.string().min(1), // -100...
  name: z.string().min(1),
  price_ton: z.number().positive(),
  duration_days: z.number().int().positive().default(30),
})

async function requireRequesterIsChatAdmin({ chatId, userId }) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, user_id: Number(userId) }),
  })
  const data = await res.json().catch(() => null)
  if (!data?.ok) return { ok: false, reason: data?.description || 'Telegram API error' }
  const status = data?.result?.status
  const isAdmin = status === 'administrator' || status === 'creator'
  return isAdmin ? { ok: true } : { ok: false, reason: `Not admin (status=${status})` }
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = await readJson(req)
  const { initData, telegram_chat_id, name, price_ton, duration_days } = parseJson(body, BodySchema)

  const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds: 300 })
  if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason })

  const tgUser = parseTelegramUser(initData)
  if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user' })

  // Require verified admin wallet before creating groups.
  const existingAdmin = await getAdminByTelegramId(String(tgUser.id))
  if (!existingAdmin?.wallet_address) return res.status(400).json({ error: 'Admin wallet not set' })
  if (!existingAdmin.wallet_verified_at) return res.status(403).json({ error: 'Admin wallet not verified' })

  const adminCheck = await requireRequesterIsChatAdmin({ chatId: telegram_chat_id, userId: tgUser.id })
  if (!adminCheck.ok) return res.status(403).json({ error: 'Not a chat admin', reason: adminCheck.reason })

  const id = crypto.randomUUID()
  const group = await createGroup({
    id,
    telegramChatId: telegram_chat_id,
    adminTelegramId: String(tgUser.id),
    name,
    priceTon: price_ton,
    durationDays: duration_days,
  })

  return res.json({ ok: true, group })
}
