import crypto from 'crypto'
import { getPool } from '../../lib/db.js'
import { setCors, readJson } from '../../lib/http.js'
import { getLogger } from '../../lib/log.js'
import { getRequestId } from '../../lib/request.js'
import { parseJson, TelegramInitDataSchema } from '../../lib/validation.js'
import { verifyTelegramData, parseTelegramUser } from '../../lib/telegram.js'
import { ipKey, rateLimit } from '../../lib/rate-limit.js'
import { getGroupById } from '../../lib/groups.js'
import { ensureMembership } from '../../lib/memberships.js'

const log = getLogger()

export default async function handler(req, res) {
  setCors(res)
  const requestId = getRequestId(req)
  res.setHeader('x-request-id', requestId)

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    // Rate limit per IP to reduce intent-spam
    try {
      const rl = await rateLimit({ key: `pi:${ipKey(req)}`, limit: 30, windowSeconds: 60 })
      if (!rl.ok) return res.status(429).json({ error: 'Too many requests' })
    } catch {
      // If REDIS_URL not set, skip rate limiting (dev)
    }

    const body = await readJson(req)
    const { initData } = parseJson(body, TelegramInitDataSchema)

    const maxAgeSeconds = 300
    const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds })
    if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason })

    const tgUser = parseTelegramUser(initData)
    if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user in initData' })

    const intentId = crypto.randomUUID()
    const now = new Date()
    // Allow plenty of time for wallet UX + network confirmation.
    // This is still enforced during verification; expired intents won't be accepted.
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000) // 60 minutes

    const groupId = body?.groupId || body?.group_id || null

    // Legacy single-tenant defaults
    let expectedTon = Number(process.env.TON_PRICE_TON || '0.1')
    let receiverAddress = process.env.TON_RECEIVER_ADDRESS
    let durationDays = 30

    if (groupId) {
      const group = await getGroupById(groupId)
      if (!group || group.is_active === false) return res.status(404).json({ error: 'Group not found or inactive' })
      expectedTon = Number(group.price_ton)
      durationDays = Number(group.duration_days || 30)

      // Admin wallet is the receiver
      const walletRow = await getPool().query('SELECT wallet_address FROM admins WHERE telegram_id=$1', [String(group.admin_telegram_id)])
      const adminWallet = walletRow.rows[0]?.wallet_address
      if (!adminWallet) return res.status(500).json({ error: 'Admin wallet not set for group' })
      receiverAddress = adminWallet

      // Ensure membership exists for this group/user
      await ensureMembership({ groupId: String(group.id), telegramId: String(tgUser.id) })
    }

    if (!receiverAddress) return res.status(500).json({ error: 'Missing TON receiver address' })

    const pool = getPool()

    await pool.query(
      `INSERT INTO payment_intents (id, telegram_id, group_id, expected_amount_ton, receiver_address, status, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), $6)`,
      [intentId, String(tgUser.id), groupId ? String(groupId) : null, expectedTon, receiverAddress, expiresAt.toISOString()],
    )

    const reference = groupId ? `tp:${tgUser.id}|pi:${intentId}|g:${groupId}` : `tp:${tgUser.id}|pi:${intentId}`

    log.info({ requestId, intentId, telegramId: String(tgUser.id) }, 'payment_intent_created')
    return res.json({
      intentId,
      expectedAmountTon: expectedTon,
      receiverAddress,
      reference,
      expiresAt: expiresAt.toISOString(),
      durationDays,
      groupId: groupId || null,
    })
  } catch (e) {
    log.error({ requestId, err: String(e?.message || e) }, 'payment_intent_create_failed')
    const statusCode = e?.statusCode || 500
    return res.status(statusCode).json({ error: 'Internal error' })
  }
}
