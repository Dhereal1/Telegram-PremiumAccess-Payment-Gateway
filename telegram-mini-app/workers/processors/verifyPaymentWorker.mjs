import { Worker } from 'bullmq'
import crypto from 'crypto'
import { pathToFileURL } from 'node:url'
import { toNano } from '@ton/core'
import { getDb } from '../_lib/db.mjs'
import { getWorkerEnv } from '../_lib/worker-env.mjs'
import { getWorkerLogger } from '../_lib/logger.mjs'
import { extractGroupIdFromComment, extractPaymentIntentIdFromComment, extractTelegramIdFromComment, getTransactions, isValidIncomingPayment, parseCommentFromTx } from '../../server/lib/toncenter.js'
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

function isExactAmountNano(tx, expectedNano) {
  try {
    const value = toBigIntSafe(tx?.in_msg?.value || '0')
    return value === expectedNano
  } catch {
    return false
  }
}

async function processJob(job) {
  const client = await pool.connect()
  try {
  const { tx } = parseJob(VerifyPaymentJobSchema, job.data || {})
  if (!tx) return { ok: false, reason: 'Missing tx' }

  const txHash = tx?.transaction_id?.hash || tx?.in_msg?.hash || tx?.hash
  if (!txHash) return { ok: false, reason: 'Missing tx hash' }

  // Idempotency: payments(tx_hash) is primary key; payment_intents has unique(tx_hash) too.
  const already = await client.query('SELECT 1 FROM payments WHERE tx_hash = $1', [String(txHash)])
  if (already.rows.length) return { ok: true, status: 'duplicate', txHash }

  const comment = parseCommentFromTx(tx) || ''
  const telegramId = extractTelegramIdFromComment(comment)
  const intentId = extractPaymentIntentIdFromComment(comment)
  const groupIdFromComment = extractGroupIdFromComment(comment)
  if (!telegramId || !intentId) {
    await logFraud({ pool: client, txHash, reason: 'missing_tp_pi', metadata: { comment } })
    return { ok: false, reason: 'Missing tp/pi in comment', txHash }
  }

  const intent = await client.query(
    `SELECT id, telegram_id, group_id, expected_amount_ton, receiver_address, status, expires_at
     FROM payment_intents
     WHERE id = $1`,
    [String(intentId)],
  )
  if (!intent.rows.length) {
    await logFraud({ pool: client, telegramId, paymentIntentId: intentId, txHash, reason: 'intent_not_found', metadata: { comment } })
    return { ok: false, reason: 'Payment intent not found', txHash }
  }

  const pi = intent.rows[0]
  if (!pi.group_id) {
    await logFraud({ pool: client, telegramId, paymentIntentId: intentId, txHash, reason: 'legacy_intent_no_group', metadata: {} })
    return { ok: false, reason: 'Intent is not group-scoped', txHash, telegramId, intentId }
  }
  if (String(pi.telegram_id) !== String(telegramId)) {
    await logFraud({ pool: client, telegramId, groupId: pi.group_id, paymentIntentId: intentId, txHash, reason: 'intent_telegram_mismatch', metadata: { comment } })
    return { ok: false, reason: 'Intent telegram mismatch', txHash }
  }

  // Strict group mapping: comment must include matching group id.
  if (!groupIdFromComment) {
    await logFraud({ pool: client, telegramId, groupId: pi.group_id, paymentIntentId: intentId, txHash, reason: 'missing_group_in_comment', metadata: { comment } })
    return { ok: false, reason: 'Missing group id in comment', txHash }
  }
  if (String(pi.group_id) !== String(groupIdFromComment)) {
    await logFraud({ pool: client, telegramId, groupId: pi.group_id, paymentIntentId: intentId, txHash, reason: 'intent_group_mismatch', metadata: { comment } })
    return { ok: false, reason: 'Intent group mismatch', txHash }
  }

  // Validate recipient + minimum amount using intent fields (multi-tenant safe).
  const receiverToCheck = pi.receiver_address
  const expectedTonStr = String(pi.expected_amount_ton || '0')
  const expectedTotalNano = BigInt(toNano(expectedTonStr).toString())
  if (!receiverToCheck) return { ok: false, reason: 'Missing receiver address', txHash, telegramId, intentId }

  const feePct = Number(process.env.PLATFORM_FEE_PERCENT || env.PLATFORM_FEE_PERCENT || '10')
  const feePctInt = Number.isFinite(feePct) && feePct >= 0 ? Math.floor(feePct) : 10
  const platformWallet = String(env.PLATFORM_WALLET_ADDRESS || '').trim() || null
  const splitEnabled = Boolean(pi.group_id && platformWallet && feePctInt > 0)

  const platformFeeNano = splitEnabled ? (expectedTotalNano * BigInt(feePctInt)) / 100n : 0n
  const adminExpectedNano = splitEnabled ? expectedTotalNano - platformFeeNano : expectedTotalNano

  const valid = isValidIncomingPayment(tx, { receiverAddress: receiverToCheck, minTon: nanoToTonString(adminExpectedNano) })
  if (!valid.ok) return { ok: false, reason: valid.reason, txHash, telegramId, intentId }
  if (!isExactAmountNano(tx, adminExpectedNano)) {
    await logFraud({
      pool,
      telegramId,
      groupId: pi.group_id,
      paymentIntentId: intentId,
      txHash,
      reason: 'amount_mismatch',
      metadata: { expectedAdminTon: nanoToTonString(adminExpectedNano), expectedTotalTon: nanoToTonString(expectedTotalNano) },
    })
    return { ok: false, reason: 'Amount mismatch', txHash, telegramId, intentId }
  }

  // Enforce platform fee (best-effort but blocking): require a matching payment into platform wallet.
  if (splitEnabled) {
    const lookback = Number(process.env.PLATFORM_FEE_LOOKBACK_LIMIT || '50')
    const txs = await getTransactions({
      apiUrl: env.TON_API_URL,
      apiKey: env.TON_API_KEY,
      address: platformWallet,
      limit: Number.isFinite(lookback) && lookback > 0 ? Math.floor(lookback) : 50,
    })

    const found = Array.isArray(txs)
      ? txs.find((t) => {
          const c = parseCommentFromTx(t) || ''
          if (!c) return false
          const tgid = extractTelegramIdFromComment(c)
          const piid = extractPaymentIntentIdFromComment(c)
          const gid = extractGroupIdFromComment(c)
          if (String(tgid || '') !== String(telegramId)) return false
          if (String(piid || '') !== String(intentId)) return false
          if (pi.group_id && String(gid || '') !== String(pi.group_id)) return false
          const ok = isValidIncomingPayment(t, { receiverAddress: platformWallet, minTon: nanoToTonString(platformFeeNano) })
          if (!ok.ok) return false
          return isExactAmountNano(t, platformFeeNano)
        })
      : null

    if (!found) {
      // Throw to trigger BullMQ retry (wallets sometimes deliver messages with slight delay).
      throw new Error('Platform fee payment not found yet')
    }
  }

  // Strict matching: only pending intents can be paid.
  if (pi.status !== 'pending') return { ok: true, status: `intent_${pi.status}`, txHash, telegramId, intentId }

  const expiresAtMs = pi.expires_at ? new Date(pi.expires_at).getTime() : null
  if (expiresAtMs != null && expiresAtMs < Date.now()) {
    await client.query(`UPDATE payment_intents SET status='expired' WHERE id=$1 AND status='pending'`, [String(intentId)])
    await logFraud({ pool: client, telegramId, groupId: pi.group_id, paymentIntentId: intentId, txHash, reason: 'intent_expired', metadata: {} })
    return { ok: false, reason: 'Intent expired', txHash, telegramId, intentId }
  }

  await client.query('BEGIN')
  try {
    // Lock intent row
    const locked = await client.query(`SELECT status FROM payment_intents WHERE id=$1 FOR UPDATE`, [String(intentId)])
    if (!locked.rows.length) throw new Error('Intent disappeared')
    if (locked.rows[0].status !== 'pending') {
      await client.query('ROLLBACK')
      return { ok: true, status: `intent_${locked.rows[0].status}`, txHash, telegramId, intentId }
    }

    await client.query(`UPDATE payment_intents SET status='paid', tx_hash=$2, paid_at=NOW() WHERE id=$1`, [String(intentId), String(txHash)])

    await client.query(
      `INSERT INTO payments (tx_hash, telegram_id, group_id, payment_intent_id, receiver_address, amount_nano, comment, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (tx_hash) DO NOTHING`,
      [String(txHash), String(telegramId), pi.group_id ? String(pi.group_id) : null, String(intentId), String(receiverToCheck), String(tx?.in_msg?.value || '0'), comment || null],
    )

    // Platform fee + admin earnings (multi-tenant groups only)
    if (pi.group_id) {
      const g = await client.query(`SELECT admin_telegram_id FROM groups WHERE id=$1`, [String(pi.group_id)])
      const adminId = g.rows[0]?.admin_telegram_id ? String(g.rows[0].admin_telegram_id) : null
      if (adminId) {
        const amountNano = expectedTotalNano
        const platformFeeNano0 = splitEnabled ? platformFeeNano : (amountNano * BigInt(feePctInt)) / 100n
        const adminAmountNano = splitEnabled ? adminExpectedNano : amountNano - platformFeeNano0

        await client.query(
          `INSERT INTO earnings (id, admin_id, group_id, payment_id, total_amount, platform_fee, admin_amount, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',NOW())
           ON CONFLICT (payment_id) DO NOTHING`,
          [
            uuid(),
            adminId,
            String(pi.group_id),
            String(txHash),
            nanoToTonString(amountNano),
            nanoToTonString(platformFeeNano0),
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

    // Multi-tenant: update membership (multi-tenant only mode).
    const gRow = await client.query(`SELECT duration_days FROM groups WHERE id=$1`, [String(pi.group_id)])
    const durationDays = Number(gRow.rows[0]?.duration_days || 30)
    const safeDurationDays = Number.isFinite(durationDays) && durationDays > 0 ? Math.floor(durationDays) : 30

    const membershipId = uuid()
    const membership = await client.query(
      `INSERT INTO memberships (id, group_id, telegram_id, subscription_status, last_payment_at, current_period_end, payment_status, expiry_date, updated_at)
       VALUES ($1,$2,$3,'active',NOW(), NOW() + make_interval(days => $4), TRUE, NOW() + make_interval(days => $4), NOW())
       ON CONFLICT (group_id, telegram_id) DO UPDATE SET
         subscription_status='active',
         last_payment_at=NOW(),
         current_period_end = GREATEST(COALESCE(memberships.current_period_end, NOW()), NOW()) + make_interval(days => $4),
         payment_status=TRUE,
         expiry_date = GREATEST(COALESCE(memberships.expiry_date, NOW()), NOW()) + make_interval(days => $4),
         updated_at=NOW()
       RETURNING id, access_granted`,
      [membershipId, String(pi.group_id), String(telegramId), safeDurationDays],
    )
    enqueueAccessMembershipId = membership.rows[0].id
    enqueueAccessGroupId = String(pi.group_id)
    const isRenewal = membership.rows[0].id !== membershipId
    alreadyGranted = isRenewal ? false : membership.rows[0].access_granted === true

    await client.query(
      `INSERT INTO subscription_events (id, telegram_id, type, metadata, created_at)
       VALUES ($1,$2,'payment_verified',$3,NOW())`,
      [uuid(), String(telegramId), JSON.stringify({ txHash: String(txHash), intentId: String(intentId) })],
    )

    await client.query('COMMIT')

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
    await client.query('ROLLBACK')
    throw e
  }
  } finally {
    client.release()
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
