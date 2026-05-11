import { setCors, readJson } from '../../lib/http.js'
import { verifyTelegramData, parseTelegramUser } from '../../lib/telegram.js'
import { rateLimit } from '../../lib/rate-limit.js'
import { getPool } from '../../lib/db.js'
import { chatComplete } from '../../lib/groq.js'
import { getLogger } from '../../lib/log.js'

const log = getLogger()

function fmtDate(d) {
  if (!d) return null
  try {
    const dt = typeof d === 'string' ? new Date(d) : d
    if (!dt || Number.isNaN(dt.getTime())) return null
    return dt.toISOString()
  } catch {
    return null
  }
}

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

  if (!initData) return res.status(400).json({ error: 'Missing initData' })
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
  const client = await pool.connect()
  let group = null
  let adminRow = null
  let membership = null
  try {
    const g = await client.query(
      `SELECT id, name, price_ton, duration_days, admin_telegram_id
       FROM groups
       WHERE id=$1 AND is_active=TRUE`,
      [String(groupId)],
    )
    group = g.rows[0] || null
    if (!group) return res.status(404).json({ error: 'Group not found' })

    if (!String(process.env.GROQ_API_KEY || '').trim()) {
      return res.json({ reply: 'AI is not configured right now.' })
    }

    const admin = await client.query('SELECT telegram_id, wallet_address, wallet_verified_at FROM admins WHERE telegram_id=$1', [
      String(group.admin_telegram_id),
    ])
    adminRow = admin.rows[0] || null

    const m = await client.query(
      `SELECT subscription_status, payment_status, access_granted, expiry_date, current_period_end, last_payment_at
       FROM memberships
       WHERE group_id=$1 AND telegram_id=$2`,
      [String(group.id), String(tgUser.id)],
    )
    membership = m.rows[0] || null
  } catch (e) {
    log.error({ err: String(e?.message || e) }, 'ai_chat_db_error')
    return res.status(503).json({ error: 'Service temporarily unavailable' })
  } finally {
    client.release()
  }

  const platformWalletAddress = String(process.env.PLATFORM_WALLET_ADDRESS || '').trim() || null
  const platformFeePercentRaw = String(process.env.PLATFORM_FEE_PERCENT || '10').trim()
  const platformFeePercent = Number.isFinite(Number(platformFeePercentRaw)) ? Math.max(0, Math.floor(Number(platformFeePercentRaw))) : 0

  let reply = null
  try {
    const facts = {
      group: {
        id: String(group.id),
        name: String(group.name),
        price_ton: Number(group.price_ton),
        duration_days: Number(group.duration_days || 30),
      },
      wallets: {
        admin_receiver_wallet: adminRow?.wallet_address ? String(adminRow.wallet_address) : null,
        platform_fee_wallet: platformWalletAddress,
      },
      platform_fee: {
        percent: platformWalletAddress ? platformFeePercent : 0,
        enabled: Boolean(platformWalletAddress && platformFeePercent > 0),
      },
      user: {
        telegram_id: String(tgUser.id),
        membership: membership
          ? {
              subscription_status: String(membership.subscription_status || 'inactive'),
              payment_status: Boolean(membership.payment_status),
              access_granted: Boolean(membership.access_granted),
              expiry_date: fmtDate(membership.expiry_date),
              current_period_end: fmtDate(membership.current_period_end),
              last_payment_at: fmtDate(membership.last_payment_at),
            }
          : null,
      },
      system_rules: [
        'Strictly answer using FACTS_JSON only. If a detail is not in FACTS_JSON, say "I don’t know from my data" and suggest the correct next step.',
        'Never invent wallet addresses, transaction hashes, payment confirmations, durations, or prices.',
        'If asked to create/manage groups: groups are created in the Telegram bot onboarding, not in the Mini App.',
        'Keep replies concise (max 3 sentences).',
      ],
    }

    reply = await chatComplete({
      system: `You are the support assistant for a Telegram premium group subscription system.\n\nFACTS_JSON:\n${JSON.stringify(facts)}\n\nINSTRUCTIONS:\n- Only use FACTS_JSON as your source of truth.\n- If the user asks for anything not present in FACTS_JSON, say you don't know from your data.\n- For TON payments: explain what the user should do in the app (connect wallet, pay the exact amount, include the reference/comment shown by the app).\n- Do not discuss unrelated topics.\n- Max 3 sentences.`,
      user: message,
      maxTokens: 200,
      temperature: 0.2,
    })
  } catch (e) {
    log.warn({ err: String(e?.message || e) }, 'ai_chat_failed')
  }
  reply = reply || 'AI assistant is not available right now.'

  return res.json({ reply })
}
