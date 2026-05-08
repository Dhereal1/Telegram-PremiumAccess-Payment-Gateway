import { setCors, readJson } from '../../lib/http.js'
import { parseTelegramUser, verifyTelegramData } from '../../lib/telegram.js'
import { parseJson } from '../../lib/validation.js'
import { z } from 'zod'
import { upsertAdminWallet } from '../../lib/groups.js'

const BodySchema = z.object({
  initData: z.string().min(1),
  wallet_address: z.string().min(1),
})

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = await readJson(req)
  const { initData, wallet_address } = parseJson(body, BodySchema)

  const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds: 300 })
  if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason })

  const tgUser = parseTelegramUser(initData)
  if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user' })

  const admin = await upsertAdminWallet({ adminTelegramId: String(tgUser.id), walletAddress: wallet_address })
  return res.json({ ok: true, admin: { telegram_id: admin.telegram_id, wallet_address: admin.wallet_address } })
}

