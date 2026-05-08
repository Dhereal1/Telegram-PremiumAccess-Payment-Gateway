import { Worker } from 'bullmq'
import crypto from 'crypto'
import { pathToFileURL } from 'node:url'
import { getDb } from '../_lib/db.mjs'
import { getWorkerEnv } from '../_lib/worker-env.mjs'
import { getWorkerLogger } from '../_lib/logger.mjs'
import { extractPaymentIntentIdFromComment, extractTelegramIdFromComment, isValidIncomingPayment, parseCommentFromTx } from '../../server/lib/toncenter.js'
import { logFailedJob } from '../_lib/failedJobs.mjs'
import { logEvent } from '../../services/subscriptionEvents.service.mjs'
import { VerifyPaymentJobSchema, parseJob } from '../_lib/jobSchemas.mjs'

const env = getWorkerEnv()
const log = getWorkerLogger()
const pool = getDb()

function uuid() {
  return crypto.randomUUID()
}

async function processJob(job) {
  const { tx } = parseJob(VerifyPaymentJobSchema, job.data || {})
  if (!tx) return { ok: false, reason: 'Missing tx' }

  const txHash = tx?.transaction_id?.hash || tx?.in_msg?.hash || tx?.hash
  if (!txHash) return { ok: false, reason: 'Missing tx hash' }

  // Idempotency: payments(tx_hash) is primary key; payment_intents has unique(tx_hash) too.
  const already = await pool.query('SELECT 1 FROM payments WHERE tx_hash = $1', [String(txHash)])
  if (already.rows.length) return { ok: true, status: 'duplicate', txHash }

  const comment = parseCommentFromTx(tx) || ''
  const telegramId = extractTelegramIdFromComment(comment)
  const intentId = extractPaymentIntentIdFromComment(comment)
  if (!telegramId || !intentId) return { ok: false, reason: 'Missing tp/pi in comment', txHash }

  const valid = isValidIncomingPayment(tx, { receiverAddress: env.TON_RECEIVER_ADDRESS, minTon: Number(env.TON_PRICE_TON) })
  if (!valid.ok) return { ok: false, reason: valid.reason, txHash }

  const intent = await pool.query(
    `SELECT id, telegram_id, expected_amount_ton, receiver_address, status, expires_at
     FROM payment_intents
     WHERE id = $1`,
    [String(intentId)],
  )
  if (!intent.rows.length) return { ok: false, reason: 'Payment intent not found', txHash }

  const pi = intent.rows[0]
  if (String(pi.telegram_id) !== String(telegramId)) return { ok: false, reason: 'Intent telegram mismatch', txHash }

  // Expiry check (use on-chain tx time when available to avoid false negatives if our listener/worker is delayed).
  const expiresAtMs = pi.expires_at ? new Date(pi.expires_at).getTime() : null
  const txTimeMs = typeof tx?.utime === 'number' ? tx.utime * 1000 : null
  const expiryGraceMs = Number(process.env.PAYMENT_INTENT_EXPIRY_GRACE_MS || String(5 * 60 * 1000))
  const isExpiredByNow = expiresAtMs != null && expiresAtMs < Date.now()
  const isExpiredByTxTime = expiresAtMs != null && txTimeMs != null && txTimeMs > (expiresAtMs + expiryGraceMs)

  // If intent is already expired, still accept payments that were made BEFORE expiry (tx.utime <= expires_at).
  // This handles "payment confirmed late" scenarios without weakening matching rules.
  if (pi.status === 'expired' && expiresAtMs != null && txTimeMs != null && txTimeMs <= (expiresAtMs + expiryGraceMs)) {
    // Treat as pending for this job and continue to mark paid transactionally.
  } else {
    if (pi.status === 'paid') return { ok: true, status: 'intent_paid', txHash, telegramId, intentId }
    if (pi.status !== 'pending') return { ok: true, status: `intent_${pi.status}`, txHash, telegramId, intentId }

    if (isExpiredByTxTime || isExpiredByNow) {
      await pool.query(`UPDATE payment_intents SET status='expired' WHERE id=$1 AND status='pending'`, [String(intentId)])
      return { ok: false, reason: 'Intent expired', txHash, telegramId, intentId }
    }
  }

  await pool.query('BEGIN')
  try {
    // Lock intent row
    const locked = await pool.query(`SELECT status FROM payment_intents WHERE id=$1 FOR UPDATE`, [String(intentId)])
    if (!locked.rows.length) throw new Error('Intent disappeared')
    if (locked.rows[0].status !== 'pending') {
      await pool.query('ROLLBACK')
      return { ok: true, status: `intent_${locked.rows[0].status}`, txHash, telegramId, intentId }
    }

    await pool.query(`UPDATE payment_intents SET status='paid', tx_hash=$2, paid_at=NOW() WHERE id=$1`, [String(intentId), String(txHash)])

    await pool.query(
      `INSERT INTO payments (tx_hash, telegram_id, payment_intent_id, receiver_address, amount_nano, comment, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (tx_hash) DO NOTHING`,
      [String(txHash), String(telegramId), String(intentId), String(env.TON_RECEIVER_ADDRESS), String(tx?.in_msg?.value || '0'), comment || null],
    )

    const user = await pool.query(
      `UPDATE users
       SET subscription_status='active',
           last_payment_at=NOW(),
           current_period_end = GREATEST(COALESCE(current_period_end, NOW()), NOW()) + INTERVAL '30 days',
           payment_status=true,
           expiry_date = GREATEST(COALESCE(expiry_date, NOW()), NOW()) + INTERVAL '30 days'
       WHERE telegram_id=$1
       RETURNING id, telegram_id, access_granted`,
      [String(telegramId)],
    )
    if (!user.rows.length) throw new Error('User not found for telegram_id')

    await pool.query(
      `INSERT INTO subscription_events (id, telegram_id, type, metadata, created_at)
       VALUES ($1,$2,'payment_verified',$3,NOW())`,
      [uuid(), String(telegramId), JSON.stringify({ txHash: String(txHash), intentId: String(intentId) })],
    )

    await pool.query('COMMIT')

    await logEvent({ userId: String(telegramId), type: 'payment_received', metadata: { txHash: String(txHash), paymentIntentId: String(intentId) } }).catch(() => {})

    return {
      ok: true,
      status: 'paid',
      txHash,
      telegramId,
      intentId,
      enqueueAccess: Boolean(env.CHANNEL_ID && user.rows[0].access_granted !== true),
      enqueueAccessUserId: user.rows[0].id,
      enqueueAccessTelegramId: user.rows[0].telegram_id,
    }
  } catch (e) {
    await pool.query('ROLLBACK')
    throw e
  }
}

export async function processVerifyPaymentCore(job) {
  return processJob(job)
}

export async function processVerifyPaymentJob(job) {
  const res = await processJob(job)
  if (res.enqueueAccess) {
    // Dynamic import to avoid Redis connections at import-time in environments that reuse the processor.
    const { enqueueAccessGrant } = await import('../producers/enqueueAccessGrant.mjs')
    await enqueueAccessGrant({ userId: res.enqueueAccessUserId, telegramId: res.enqueueAccessTelegramId })
  }
  log.info(
    { jobId: job.id, queue: 'payment-verification', userId: res.telegramId, paymentIntentId: res.intentId, txHash: res.txHash, ...res },
    'verify_payment_done',
  )
  return res
}

export async function startVerifyPaymentWorker() {
  const [{ connection }, { paymentQueue }, { startQueueStatsLogger }] = await Promise.all([
    import('../queues/connection.mjs'),
    import('../queues/paymentQueue.mjs'),
    import('../_lib/queueStats.mjs'),
  ])

  startQueueStatsLogger({ logger: log, queueName: 'payment-verification', queue: paymentQueue })

  const worker = new Worker('payment-verification', processVerifyPaymentJob, {
    connection,
    concurrency: Number(process.env.VERIFY_WORKER_CONCURRENCY || '4'),
  })

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, queue: 'payment-verification', err: String(err?.message || err) }, 'verify_payment_failed')
    logFailedJob({ jobId: job?.id, queue: 'payment-verification', payload: job?.data, error: String(err?.message || err) }).catch(() => {})
  })

  log.info('verifyPaymentWorker started')
  return worker
}

// Only start the long-running worker when executed directly (not when imported by serverless routes).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startVerifyPaymentWorker()
}
