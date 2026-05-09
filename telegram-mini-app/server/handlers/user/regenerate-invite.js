import { getPool } from '../../lib/db.js'
import { setCors, readJson } from '../../lib/http.js'
import { verifyTelegramData, parseTelegramUser } from '../../lib/telegram.js'
import { parseJson, TelegramInitDataSchema } from '../../lib/validation.js'
import { getQueues } from '../../lib/queue.js'
import { z } from 'zod'

const BodySchema = TelegramInitDataSchema.extend({
  groupId: z.string().uuid().optional(),
  group_id: z.string().uuid().optional(),
})

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

  const parsed = parseJson(body, BodySchema)
  const initData = parsed.initData
  const groupId = parsed.groupId || parsed.group_id || null
  const maxAgeSeconds = Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || '300')
  const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds })
  if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason })

  const tgUser = parseTelegramUser(initData)
  if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user in initData' })

  if (!groupId) return res.status(400).json({ error: 'Missing groupId' })

  const pool = getPool()
  const { accessGrantQueue } = getQueues()

  const m = await pool.query(
    `SELECT id, telegram_id, payment_status
     FROM memberships
     WHERE group_id=$1 AND telegram_id=$2`,
    [String(groupId), String(tgUser.id)],
  )
  const membership = m.rows[0]
  if (!membership) return res.status(404).json({ error: 'Membership not found' })
  if (!membership.payment_status) return res.status(403).json({ error: 'Not paid' })

  await accessGrantQueue.add(
    'regenerate-invite',
    { membershipId: String(membership.id), groupId: String(groupId), telegramId: String(tgUser.id), forceRegenerate: true },
    { jobId: `regenm_${String(membership.id)}_${Date.now()}` },
  )

  return res.json({ ok: true, enqueued: true, mode: 'membership', membershipId: String(membership.id), groupId: String(groupId) })
}
