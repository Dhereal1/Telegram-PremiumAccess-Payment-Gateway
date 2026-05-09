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
import { z } from 'zod'
import { queryWithRetry } from '../../lib/db-retry.js'
import { Address, toNano } from '@ton/core'

const log = getLogger()
const GroupIdSchema = z.string().uuid()

function toUserFriendlyAddress(raw) {
  try {
    return Address.parse(String(raw)).toString({ bounceable: true, urlSafe: true })
  } catch {
    return String(raw)
  }
}

function nanoToTonString(nano) {
  const n = typeof nano === 'bigint' ? nano : BigInt(String(nano || '0'))
  const sign = n < 0n ? '-' : ''
  const abs = n < 0n ? -n : n
  const whole = abs / 1000000000n
  const frac = abs % 1000000000n
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '')
  return fracStr ? `${sign}${whole.toString()}.${fracStr}` : `${sign}${whole.toString()}`
}

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

    const maxAgeSeconds = Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || '300')
    const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds })
    if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason })

    const tgUser = parseTelegramUser(initData)
    if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user in initData' })

    // Rate limit per Telegram user (anti-spam / abuse). Best-effort when Redis is available.
    try {
      const rlUser = await rateLimit({ key: `pi_u:${String(tgUser.id)}`, limit: 3, windowSeconds: 60 })
      if (!rlUser.ok) return res.status(429).json({ error: 'Too many payment intents, slow down' })
    } catch {
      // If REDIS_URL not set, skip rate limiting (dev)
    }

    const intentId = crypto.randomUUID()
    const now = new Date()
    // Allow plenty of time for wallet UX + network confirmation.
    // This is still enforced during verification; expired intents won't be accepted.
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000) // 60 minutes

    const groupId = body?.groupId || body?.group_id || null
    if (!groupId) return res.status(400).json({ error: 'Missing groupId' })
    if (!GroupIdSchema.safeParse(String(groupId)).success) return res.status(400).json({ error: 'Invalid groupId' })

    const group = await getGroupById(groupId)
    if (!group || group.is_active === false) return res.status(404).json({ error: 'Group not found or inactive' })
    const expectedTon = Number(group.price_ton)
    const durationDays = Number(group.duration_days || 30)

    // Admin wallet is the receiver
    const walletRow = await queryWithRetry(getPool(), 'SELECT wallet_address FROM admins WHERE telegram_id=$1', [String(group.admin_telegram_id)], { attempts: 3 })
    const adminWallet = walletRow.rows[0]?.wallet_address
    if (!adminWallet) return res.status(500).json({ error: 'Admin wallet not set for group' })
    const receiverAddress = toUserFriendlyAddress(adminWallet)

    // Ensure membership exists for this group/user
    await ensureMembership({ groupId: String(group.id), telegramId: String(tgUser.id) })

    const pool = getPool()

    await queryWithRetry(
      pool,
      `INSERT INTO payment_intents (id, telegram_id, group_id, expected_amount_ton, receiver_address, status, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), $6)`,
      [intentId, String(tgUser.id), groupId ? String(groupId) : null, expectedTon, receiverAddress, expiresAt.toISOString()],
      { attempts: 3 },
    )

    const reference = `tp:${tgUser.id}|pi:${intentId}|g:${groupId}`

    // Fee enforcement (client-side split transfer).
    // If PLATFORM_WALLET_ADDRESS is set, the Mini App will ask the user to send two messages:
    // - platform fee to PLATFORM_WALLET_ADDRESS
    // - remainder to the admin receiver address
    const platformWalletAddress = String(process.env.PLATFORM_WALLET_ADDRESS || '').trim() || null
    const platformWalletAddressFriendly = platformWalletAddress ? toUserFriendlyAddress(platformWalletAddress) : null
    const feePctRaw = String(process.env.PLATFORM_FEE_PERCENT || '10').trim()
    const feePct = Number(feePctRaw)
    const feePctInt = Number.isFinite(feePct) && feePct > 0 ? Math.floor(feePct) : 0

    let platformFeeTon = null
    let adminAmountTon = null
    if (platformWalletAddress && feePctInt > 0) {
      const totalNano = BigInt(toNano(String(expectedTon)).toString())
      const platformFeeNano = (totalNano * BigInt(feePctInt)) / 100n
      const adminNano = totalNano - platformFeeNano
      platformFeeTon = nanoToTonString(platformFeeNano)
      adminAmountTon = nanoToTonString(adminNano)
    }

    log.info({ requestId, intentId, telegramId: String(tgUser.id) }, 'payment_intent_created')
    return res.json({
      intentId,
      expectedAmountTon: expectedTon,
      receiverAddress,
      reference,
      expiresAt: expiresAt.toISOString(),
      durationDays,
      groupId: String(groupId),
      platformWalletAddress: platformWalletAddressFriendly,
      platformFeePercent: feePctInt || 0,
      platformFeeTon,
      adminAmountTon,
    })
  } catch (e) {
    log.error({ requestId, err: String(e?.message || e) }, 'payment_intent_create_failed')
    const statusCode = e?.statusCode || 500
    return res.status(statusCode).json({ error: 'Internal error' })
  }
}
