import { setCors, readJson } from '../../lib/http.js'
import { getLogger } from '../../lib/log.js'
import { getRequestId } from '../../lib/request.js'
import { parseJson } from '../../lib/validation.js'
import { verifyTelegramData, parseTelegramUser } from '../../lib/telegram.js'
import { getPool } from '../../lib/db.js'
import { getQueues } from '../../lib/queue.js'
import { z } from 'zod'

const log = getLogger()

const BodySchema = z.object({
  initData: z.string().min(1),
  tx: z.any(),
})

export default async function handler(req, res) {
  setCors(res)
  const requestId = getRequestId(req)
  res.setHeader('x-request-id', requestId)

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const body = await readJson(req)
    const { initData, tx } = parseJson(body, BodySchema)
    const txHash = tx?.transaction_id?.hash || tx?.in_msg?.hash || tx?.hash
    if (!txHash) return res.status(400).json({ error: 'Missing tx hash' })

    const maxAgeSeconds = 300
    const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds })
    if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason })

    const tgUser = parseTelegramUser(initData)
    if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user in initData' })

    const pool = getPool()
    const exists = await pool.query('SELECT 1 FROM payments WHERE tx_hash = $1', [String(txHash)])
    if (exists.rows.length) return res.json({ ok: true, status: 'already_processed' })

    const { paymentVerificationQueue } = getQueues()
    await paymentVerificationQueue.add(
      'verify-payment',
      { tx },
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
