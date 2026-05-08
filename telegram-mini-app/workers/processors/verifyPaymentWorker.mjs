import { Worker } from 'bullmq'
import crypto from 'crypto'
import { pathToFileURL } from 'node:url'
import { toNano } from '@ton/core'
import { getDb } from '../_lib/db.mjs'
import { getWorkerEnv } from '../_lib/worker-env.mjs'
import { getWorkerLogger } from '../_lib/logger.mjs'
import { extractGroupIdFromComment, extractPaymentIntentIdFromComment, extractTelegramIdFromComment, isValidIncomingPayment, parseCommentFromTx } from '../../server/lib/toncenter.js'
import { logFailedJob } from '../_lib/failedJobs.mjs'
import { logFraud } from '../_lib/fraudLogs.mjs'
import { logEvent } from '../../services/subscriptionEvents.service.mjs'
import { VerifyPaymentJobSchema, parseJob } from '../_lib/jobSchemas.mjs'

const env = getWorkerEnv()
const log = getWorkerLogger()
const pool = getDb()

function uuid() {
  return crypto.randomUUID()
}

function toBigIntSafe(v) {
  try {
    return BigInt(String(v || '0'))
  } catch {
    return 0n
  }
}

function nanoToTonString(nano) {
  const n = typeof nano === 'bigint' ? nano : toBigIntSafe(nano)
  const sign = n < 0n ? '-' : ''
  const abs = n < 0n ? -n : n
  const whole = abs / 1000000000n
  const frac = abs % 1000000000n
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '')
  return fracStr ? `${sign}${whole.toString()}.${fracStr}` : `${sign}${whole.toString()}`
}

function isExactAmount(tx, expectedTon) {
  try {
    const value = toBigIntSafe(tx?.in_msg?.value || '0')
    const expected = BigInt(toNano(Number(expectedTon)).toString())
    return value === expected
  } catch {
    return false
  }
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
  if (!telegramId || !intentId) {
    await logFraud({ pool, txHash, reason: 'missing_tp_pi', metadata: { comment } })
    return { ok: false, reason: 'Missing tp/pi in comment', txHash }
  }

  const intent = await pool.query(
    `SELECT id, telegram_id, group_id, expected_amount_ton, receiver_address, status, expires_at
     FROM payment_intents
     WHERE id = $1`,
    [String(intentId)],
  )
  if (!intent.rows.length) {
    await logFraud({ pool, telegramId, paymentIntentId: intentId, txHash, reason: 'intent_not_found', metadata: { comment } })
    return { ok: false, reason: 'Payment intent not found', txHash }
  }

  const pi = intent.rows[0]
  if (String(pi.telegram_id) !== String(telegramId)) {
    await logFraud({ pool, telegramId, groupId: pi.group_id, paymentIntentId: intentId, txHash, reason: 'intent_telegram_mismatch', metadata: { comment } })
    return { ok: false, reason: 'Intent telegram mismatch', txHash }
  }

  // Strict group mapping: if intent is group-scoped, comment must include matching group id.
  if (pi.group_id) {
    if (!groupIdFromComment) {
      await logFraud({ pool, telegramId, groupId: pi.group_id, paymentIntentId: intentId, txHash, reason: 'missing_group_in_comment', metadata: { comment } })
      return { ok: false, reason: 'Missing group id in comment', txHash }
    }
    if (String(pi.group_id) !== String(groupIdFromComment)) {
      await logFraud({ pool, telegramId, groupId: pi.group_id, paymentIntentId: intentId, txHash, reason: 'intent_group_mismatch', metadata: { comment } })
      return { ok: false, reason: 'Intent group mismatch', txHash }
    }
  }

  // Validate recipient + minimum amount using intent fields (multi-tenant safe).
  const receiverToCheck = pi.receiver_address || env.TON_RECEIVER_ADDRESS
  const expectedTon = Number(pi.expected_amount_ton || env.TON_PRICE_TON || '0')
  if (!receiverToCheck) return { ok: false, reason: 'Missing receiver address', txHash, telegramId, intentId }
  const valid = isValidIncomingPayment(tx, { receiverAddress: receiverToCheck, minTon: expectedTon })
  if (!valid.ok) return { ok: false, reason: valid.reason, txHash, telegramId, intentId }
  if (!isExactAmount(tx, expectedTon)) {
    await logFraud({ pool, telegramId, groupId: pi.group_id, paymentIntentId: intentId, txHash, reason: 'amount_mismatch', metadata: { expectedTon } })
    return { ok: false, reason: 'Amount mismatch', txHash, telegramId, intentId }
  }

  // Strict matching: only pending intents can be paid.
  if (pi.status !== 'pending') return { ok: true, status: `intent_${pi.status}`, txHash, telegramId, intentId }

  const expiresAtMs = pi.expires_at ? new Date(pi.expires_at).getTime() : null
  if (expiresAtMs != null && expiresAtMs < Date.now()) {
    await pool.query(`UPDATE payment_intents SET status='expired' WHERE id=$1 AND status='pending'`, [String(intentId)])
    await logFraud({ pool, telegramId, groupId: pi.group_id, paymentIntentId: intentId, txHash, reason: 'intent_expired', metadata: {} })
    return { ok: false, reason: 'Intent expired', txHash, telegramId, intentId }
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
      `INSERT INTO payments (tx_hash, telegram_id, group_id, payment_intent_id, receiver_address, amount_nano, comment, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (tx_hash) DO NOTHING`,
      [String(txHash), String(telegramId), pi.group_id ? String(pi.group_id) : null, String(intentId), String(receiverToCheck), String(tx?.in_msg?.value || '0'), comment || null],
    )

    // Platform fee + admin earnings (multi-tenant groups only)
    if (pi.group_id) {
      const g = await pool.query(`SELECT admin_telegram_id FROM groups WHERE id=$1`, [String(pi.group_id)])
      const adminId = g.rows[0]?.admin_telegram_id ? String(g.rows[0].admin_telegram_id) : null
      if (adminId) {
        const amountNano = toBigIntSafe(tx?.in_msg?.value || '0')
        const feePct = Number(process.env.PLATFORM_FEE_PERCENT || env.PLATFORM_FEE_PERCENT || '10')
        const feePctInt = Number.isFinite(feePct) && feePct >= 0 ? Math.floor(feePct) : 10

        const platformFeeNano = (amountNano * BigInt(feePctInt)) / 100n
        const adminAmountNano = amountNano - platformFeeNano

        await pool.query(
          `INSERT INTO earnings (id, admin_id, group_id, payment_id, total_amount, platform_fee, admin_amount, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',NOW())
           ON CONFLICT (payment_id) DO NOTHING`,
          [
            uuid(),
            adminId,
            String(pi.group_id),
            String(txHash),
            nanoToTonString(amountNano),
            nanoToTonString(platformFeeNano),
            nanoToTonString(adminAmountNano),
          ],
        )
      }
    }

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
