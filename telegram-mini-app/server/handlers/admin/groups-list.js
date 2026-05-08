import { setCors, readJson } from '../../lib/http.js'
import { parseTelegramUser, verifyTelegramData } from '../../lib/telegram.js'
import { parseJson } from '../../lib/validation.js'
import { z } from 'zod'
import { listGroupsByAdmin } from '../../lib/groups.js'

const BodySchema = z.object({
  initData: z.string().min(1),
})

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = await readJson(req)
  const { initData } = parseJson(body, BodySchema)

  const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds: 300 })
  if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason })

  const tgUser = parseTelegramUser(initData)
  if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user' })

  const groups = await listGroupsByAdmin(String(tgUser.id))
  return res.json({ ok: true, groups })
}

