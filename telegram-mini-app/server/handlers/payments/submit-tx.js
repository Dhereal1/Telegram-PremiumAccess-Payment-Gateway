import { setCors, readJson } from '../../lib/http.js'
import { getLogger } from '../../lib/log.js'
import { getRequestId } from '../../lib/request.js'
import { parseJson } from '../../lib/validation.js'
import { verifyTelegramData, parseTelegramUser } from '../../lib/telegram.js'
import { getPool } from '../../lib/db.js'
import { getQueues } from '../../lib/queue.js'
import { getTransactions, parseCommentFromTx } from '../../lib/toncenter.js'
import { z } from 'zod'

const log = getLogger()

const BodySchema = z.object({
  initData: z.string().min(1),
  intentId: z.string().uuid(),
  txHash: z.string().min(10),
})

export default async function handler(req, res) {
  setCors(res)
  const requestId = getRequestId(req)
  res.setHeader('x-request-id', requestId)

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = await readJson(req)
    const { initData, intentId, txHash } = parseJson(body, BodySchema)

    const maxAgeSeconds = Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || '300')
    const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds })
    if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason })

    const tgUser = parseTelegramUser(initData)
    if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user in initData' })

    const pool = getPool()

    // Intent must belong to caller; prevents cross-user spoofing.
    const intentRes = await pool.query(
      `SELECT id, telegram_id, group_id, receiver_address, status, expires_at
       FROM payment_intents
       WHERE id = $1`,
      [String(intentId)],
    )
    if (!intentRes.rows.length) return res.status(404).json({ error: 'Payment intent not found' })
    const pi = intentRes.rows[0]
    if (String(pi.telegram_id) !== String(tgUser.id)) return res.status(403).json({ error: 'Forbidden' })
    if (pi.status !== 'pending') return res.json({ ok: true, status: `intent_${pi.status}` })

    const expiresAtMs = pi.expires_at ? new Date(pi.expires_at).getTime() : null
    if (expiresAtMs != null && expiresAtMs < Date.now()) {
      return res.status(410).json({ error: 'Payment intent expired' })
    }

    const exists = await pool.query('SELECT 1 FROM payments WHERE tx_hash = $1', [String(txHash)])
    if (exists.rows.length) return res.json({ ok: true, status: 'already_processed' })

    const receiverAddress = pi.receiver_address
    if (!receiverAddress) return res.status(500).json({ error: 'Intent missing receiver_address' })

    // IMPORTANT: never trust client-supplied transaction objects.
    // Fetch recent transactions for the receiver wallet from TON Center and match by tx hash.
    const apiUrl = process.env.TON_API_URL || 'https://toncenter.com/api/v2'
    const apiKey = process.env.TON_API_KEY || ''
    const limit = Number(process.env.SUBMIT_TX_LOOKBACK_LIMIT || '50')

    const txs = await getTransactions({
      apiUrl,
      apiKey,
      address: String(receiverAddress),
      limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50,
    })

    const matched = Array.isArray(txs)
      ? txs.find((t) => (t?.transaction_id?.hash || t?.in_msg?.hash || t?.hash) === String(txHash))
      : null

    if (!matched) {
      // Client can retry; listener will eventually enqueue too.
      return res.status(202).json({ ok: true, status: 'not_found_yet' })
    }

    // Optional fast-fail: ensure comment contains expected intent id before enqueueing.
    const comment = parseCommentFromTx(matched) || ''
    if (!String(comment).includes(`pi:${String(intentId)}`)) {
      return res.status(400).json({ error: 'Transaction does not match intent' })
    }

    const { paymentVerificationQueue } = getQueues()
    await paymentVerificationQueue.add(
      'verify-payment',
      { tx: matched },
      { jobId: `tx_${String(txHash)}`, attempts: 8, backoff: { type: 'exponential', delay: 5000 } },
    )

    log.info({ requestId, txHash }, 'payment_verification_enqueued')
    return res.json({ ok: true, enqueued: true })
  } catch (e) {
    log.error({ requestId, err: String(e?.message || e) }, 'submit_tx_failed')
    const statusCode = e?.statusCode || 500
    return res.status(statusCode).json({ error: 'Internal error' })
  }
}
