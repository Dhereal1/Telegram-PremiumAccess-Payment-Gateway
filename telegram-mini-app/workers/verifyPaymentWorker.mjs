import { Worker } from 'bullmq';
import crypto from 'crypto';
import { getRedis } from './_lib/redis.mjs';
import { getDb } from './_lib/db.mjs';
import { getWorkerEnv } from './_lib/worker-env.mjs';
import { getWorkerLogger } from './_lib/logger.mjs';
import {
  extractPaymentIntentIdFromComment,
  extractTelegramIdFromComment,
  isValidIncomingPayment,
  parseCommentFromTx,
} from '../api/_lib/toncenter.js';
import { Queue } from 'bullmq';

const env = getWorkerEnv();
const log = getWorkerLogger();
const connection = getRedis();
const pool = getDb();
const accessGrantQueue = new Queue('access_grant_queue', { connection });

function uuid() {
  return crypto.randomUUID();
}

async function processJob(job) {
  const tx = job.data?.tx;
  if (!tx) return { ok: false, reason: 'Missing tx' };

  const txHash = tx?.transaction_id?.hash || tx?.in_msg?.hash || tx?.hash;
  if (!txHash) return { ok: false, reason: 'Missing tx hash' };

  // Idempotency: payments(tx_hash) is primary key; payment_intents has unique(tx_hash) too.
  const already = await pool.query('SELECT 1 FROM payments WHERE tx_hash = $1', [String(txHash)]);
  if (already.rows.length) return { ok: true, status: 'duplicate' };

  const comment = parseCommentFromTx(tx) || '';
  const telegramId = extractTelegramIdFromComment(comment);
  const intentId = extractPaymentIntentIdFromComment(comment);
  if (!telegramId || !intentId) return { ok: false, reason: 'Missing tp/pi in comment', txHash };

  const valid = isValidIncomingPayment(tx, { receiverAddress: env.TON_RECEIVER_ADDRESS, minTon: Number(env.TON_PRICE_TON) });
  if (!valid.ok) return { ok: false, reason: valid.reason, txHash };

  const intent = await pool.query(
    `SELECT id, telegram_id, expected_amount_ton, receiver_address, status, expires_at
     FROM payment_intents
     WHERE id = $1`,
    [String(intentId)],
  );
  if (!intent.rows.length) return { ok: false, reason: 'Payment intent not found', txHash };

  const pi = intent.rows[0];
  if (String(pi.telegram_id) !== String(telegramId)) return { ok: false, reason: 'Intent telegram mismatch', txHash };
  if (pi.status !== 'pending') return { ok: true, status: `intent_${pi.status}`, txHash };

  // Expiry check
  if (pi.expires_at && new Date(pi.expires_at).getTime() < Date.now()) {
    await pool.query(`UPDATE payment_intents SET status='expired' WHERE id=$1 AND status='pending'`, [String(intentId)]);
    return { ok: false, reason: 'Intent expired', txHash };
  }

  await pool.query('BEGIN');
  try {
    // Lock intent row
    const locked = await pool.query(`SELECT status FROM payment_intents WHERE id=$1 FOR UPDATE`, [String(intentId)]);
    if (!locked.rows.length) throw new Error('Intent disappeared');
    if (locked.rows[0].status !== 'pending') {
      await pool.query('ROLLBACK');
      return { ok: true, status: `intent_${locked.rows[0].status}`, txHash };
    }

    await pool.query(
      `UPDATE payment_intents SET status='paid', tx_hash=$2, paid_at=NOW()
       WHERE id=$1`,
      [String(intentId), String(txHash)],
    );

    await pool.query(
      `INSERT INTO payments (tx_hash, telegram_id, payment_intent_id, receiver_address, amount_nano, comment, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (tx_hash) DO NOTHING`,
      [
        String(txHash),
        String(telegramId),
        String(intentId),
        String(env.TON_RECEIVER_ADDRESS),
        String(tx?.in_msg?.value || '0'),
        comment || null,
      ],
    );

    const user = await pool.query(
      `UPDATE users
       SET subscription_status='active',
           last_payment_at=NOW(),
           current_period_end = GREATEST(COALESCE(current_period_end, NOW()), NOW()) + INTERVAL '30 days',
           payment_status=true,
           expiry_date = GREATEST(COALESCE(expiry_date, NOW()), NOW()) + INTERVAL '30 days'
       WHERE telegram_id=$1
       RETURNING access_granted`,
      [String(telegramId)],
    );
    if (!user.rows.length) throw new Error('User not found for telegram_id');

    await pool.query(
      `INSERT INTO subscription_events (id, telegram_id, type, metadata, created_at)
       VALUES ($1,$2,'payment_verified',$3,NOW())`,
      [uuid(), String(telegramId), JSON.stringify({ txHash: String(txHash), intentId: String(intentId) })],
    );

    await pool.query('COMMIT');

    // Event-driven access granting
    if (env.CHANNEL_ID && user.rows[0].access_granted !== true) {
      await accessGrantQueue.add(
        'grant_access',
        { telegramId: String(telegramId) },
        { jobId: `grant:${String(telegramId)}`, attempts: 10, backoff: { type: 'exponential', delay: 10000 } },
      );
    }

    return { ok: true, status: 'paid', txHash, telegramId, intentId };
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

const worker = new Worker(
  'payment_verification_queue',
  async (job) => {
    const res = await processJob(job);
    log.info({ jobId: job.id, ...res }, 'verify_payment_done');
    return res;
  },
  {
    connection,
    concurrency: Number(process.env.VERIFY_WORKER_CONCURRENCY || '4'),
    // built-in backoff/retry is configured per-job when enqueued
  },
);

worker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err: String(err?.message || err) }, 'verify_payment_failed');
});

log.info('verifyPaymentWorker started');
