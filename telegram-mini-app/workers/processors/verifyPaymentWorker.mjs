import { Worker } from 'bullmq'
import crypto from 'crypto'
import { pathToFileURL } from 'node:url'
import { getDb } from '../_lib/db.mjs'
import { getWorkerEnv } from '../_lib/worker-env.mjs'
import { getWorkerLogger } from '../_lib/logger.mjs'
import { extractGroupIdFromComment, extractPaymentIntentIdFromComment, extractTelegramIdFromComment, isValidIncomingPayment, parseCommentFromTx } from '../../server/lib/toncenter.js'
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
  const groupIdFromComment = extractGroupIdFromComment(comment)
  if (!telegramId || !intentId) return { ok: false, reason: 'Missing tp/pi in comment', txHash }

  const intent = await pool.query(
    `SELECT id, telegram_id, group_id, expected_amount_ton, receiver_address, status, expires_at
     FROM payment_intents
     WHERE id = $1`,
    [String(intentId)],
  )
  if (!intent.rows.length) return { ok: false, reason: 'Payment intent not found', txHash }

  const pi = intent.rows[0]
  if (String(pi.telegram_id) !== String(telegramId)) return { ok: false, reason: 'Intent telegram mismatch', txHash }
  if (pi.group_id && groupIdFromComment && String(pi.group_id) !== String(groupIdFromComment)) {
    return { ok: false, reason: 'Intent group mismatch', txHash }
  }

  // Validate recipient + minimum amount using intent fields (multi-tenant safe).
  const receiverToCheck = pi.receiver_address || env.TON_RECEIVER_ADDRESS
  const minTon = Number(pi.expected_amount_ton || env.TON_PRICE_TON || '0')
  if (!receiverToCheck) return { ok: false, reason: 'Missing receiver address', txHash, telegramId, intentId }
  const valid = isValidIncomingPayment(tx, { receiverAddress: receiverToCheck, minTon })
  if (!valid.ok) return { ok: false, reason: valid.reason, txHash, telegramId, intentId }

  // Expiry check (use on-chain tx time when available to avoid false negatives if our listener/worker is delayed).
  const expiresAtMs = pi.expires_at ? new Date(pi.expires_at).getTime() : null
  const txTimeMs = typeof tx?.utime === 'number' ? tx.utime * 1000 : null
  const expiryGraceMs = Number(process.env.PAYMENT_INTENT_EXPIRY_GRACE_MS || String(5 * 60 * 1000))
  const isExpiredByNow = expiresAtMs != null && expiresAtMs < Date.now()
  const isExpiredByTxTime = expiresAtMs != null && txTimeMs != null && txTimeMs > (expiresAtMs + expiryGraceMs)

  // If intent is already expired, still accept payments that were made "close enough" to expiry.
  // This handles "payment confirmed late" scenarios without weakening matching rules.
  const allowLateExpiredIntent =
    pi.status === 'expired' && expiresAtMs != null && txTimeMs != null && txTimeMs <= (expiresAtMs + expiryGraceMs)

  if (!allowLateExpiredIntent) {
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
      // Permit late processing if the intent expired but the tx was within the grace window.
      if (!(locked.rows[0].status === 'expired' && allowLateExpiredIntent)) {
        await pool.query('ROLLBACK')
        return { ok: true, status: `intent_${locked.rows[0].status}`, txHash, telegramId, intentId }
      }
    }

    await pool.query(`UPDATE payment_intents SET status='paid', tx_hash=$2, paid_at=NOW() WHERE id=$1`, [String(intentId), String(txHash)])

    await pool.query(
      `INSERT INTO payments (tx_hash, telegram_id, group_id, payment_intent_id, receiver_address, amount_nano, comment, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (tx_hash) DO NOTHING`,
      [String(txHash), String(telegramId), pi.group_id ? String(pi.group_id) : null, String(intentId), String(receiverToCheck), String(tx?.in_msg?.value || '0'), comment || null],
    )

    let enqueueAccessUserId = null
    let enqueueAccessTelegramId = String(telegramId)
    let enqueueAccessMembershipId = null
    let enqueueAccessGroupId = null
    let alreadyGranted = false

    // Multi-tenant: update membership if intent is group-scoped.
    if (pi.group_id) {
      const membershipId = uuid()
      const membership = await pool.query(
        `INSERT INTO memberships (id, group_id, telegram_id, subscription_status, last_payment_at, current_period_end, payment_status, expiry_date, updated_at)
         VALUES ($1,$2,$3,'active',NOW(), NOW() + INTERVAL '30 days', TRUE, NOW() + INTERVAL '30 days', NOW())
         ON CONFLICT (group_id, telegram_id) DO UPDATE SET
           subscription_status='active',
           last_payment_at=NOW(),
           current_period_end = GREATEST(COALESCE(memberships.current_period_end, NOW()), NOW()) + INTERVAL '30 days',
           payment_status=TRUE,
           expiry_date = GREATEST(COALESCE(memberships.expiry_date, NOW()), NOW()) + INTERVAL '30 days',
           updated_at=NOW()
         RETURNING id, access_granted`,
        [membershipId, String(pi.group_id), String(telegramId)],
      )
      enqueueAccessMembershipId = membership.rows[0].id
      enqueueAccessGroupId = String(pi.group_id)
      alreadyGranted = membership.rows[0].access_granted === true
    } else {
      // Legacy single-tenant: update users table.
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
      enqueueAccessUserId = user.rows[0].id
      enqueueAccessTelegramId = user.rows[0].telegram_id
      alreadyGranted = user.rows[0].access_granted === true
    }

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
      enqueueAccess: Boolean((env.CHANNEL_ID || pi.group_id) && alreadyGranted !== true),
      enqueueAccessUserId,
      enqueueAccessTelegramId,
      enqueueAccessMembershipId,
      enqueueAccessGroupId,
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
    await enqueueAccessGrant({
      userId: res.enqueueAccessUserId,
      membershipId: res.enqueueAccessMembershipId,
      groupId: res.enqueueAccessGroupId,
      telegramId: res.enqueueAccessTelegramId,
    })
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
