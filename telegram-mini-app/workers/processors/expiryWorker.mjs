import { Worker } from 'bullmq'
import { pathToFileURL } from 'node:url'
import { getWorkerLogger } from '../_lib/logger.mjs'
import { getDb } from '../_lib/db.mjs'
import { logEvent } from '../../services/subscriptionEvents.service.mjs'
import { kickChatMember } from '../../services/telegram.service.mjs'
import { logFailedJob } from '../_lib/failedJobs.mjs'
import { ExpiryJobSchema, parseJob } from '../_lib/jobSchemas.mjs'
import { getPool } from '../../db/index.mjs'

const logger = getWorkerLogger()
const pool = getDb()

async function expireBatch(limit) {
  const res = await pool.query(
    `SELECT id, telegram_id
     FROM users
     WHERE payment_status = true
       AND expiry_date IS NOT NULL
       AND expiry_date < NOW()
     ORDER BY expiry_date ASC
     LIMIT $1`,
    [limit],
  )

  let expired = 0
  for (const row of res.rows) {
    const upd = await pool.query(
      `UPDATE users
       SET payment_status=false, access_granted=false, subscription_status='expired'
       WHERE id=$1
         AND payment_status=true
         AND expiry_date IS NOT NULL
         AND expiry_date < NOW()
       RETURNING telegram_id`,
      [row.id],
    )

    // Idempotency: only emit events if we actually transitioned state.
    if (!upd.rows.length) continue
    expired++

    await logEvent({ userId: String(row.telegram_id), type: 'subscription_expired', metadata: {} }).catch(() => {})
    await logEvent({ userId: String(row.telegram_id), type: 'access_revoked', metadata: {} }).catch(() => {})

    // Best-effort: remove from legacy channel if configured.
    try {
      const channelId = process.env.CHANNEL_ID
      if (channelId) await kickChatMember({ chatId: channelId, userId: row.telegram_id })
    } catch (e) {
      logger.warn({ telegramId: String(row.telegram_id), err: String(e?.message || e) }, 'expiry_kick_failed_legacy')
    }
  }

  return expired
}

async function expireMembershipBatch(limit) {
  const res = await pool.query(
    `SELECT id, telegram_id, group_id
     FROM memberships
     WHERE payment_status = true
       AND expiry_date IS NOT NULL
       AND expiry_date < NOW()
     ORDER BY expiry_date ASC
     LIMIT $1`,
    [limit],
  )

  let expired = 0
  for (const row of res.rows) {
    const upd = await pool.query(
      `UPDATE memberships
       SET payment_status=false,
           access_granted=false,
           subscription_status='expired',
           updated_at=NOW()
       WHERE id=$1
         AND payment_status=true
         AND expiry_date IS NOT NULL
         AND expiry_date < NOW()
       RETURNING telegram_id, group_id`,
      [String(row.id)],
    )
    if (!upd.rows.length) continue
    expired++

    const telegramId = upd.rows[0].telegram_id
    const groupId = upd.rows[0].group_id
    await logEvent({ userId: String(telegramId), type: 'subscription_expired', metadata: { groupId: String(groupId) } }).catch(() => {})
    await logEvent({ userId: String(telegramId), type: 'access_revoked', metadata: { groupId: String(groupId) } }).catch(() => {})

    // Best-effort: remove user from Telegram chat if bot is admin.
    try {
      const gp = getPool()
      const g = await gp.query('SELECT telegram_chat_id FROM groups WHERE id=$1', [String(groupId)])
      const chatId = g.rows[0]?.telegram_chat_id
      if (chatId) await kickChatMember({ chatId, userId: telegramId })
    } catch (e) {
      logger.warn({ telegramId: String(telegramId), groupId: String(groupId), err: String(e?.message || e) }, 'expiry_kick_failed')
    }
  }

  return expired
}

export async function processExpiryJob(job) {
  const { limit } = parseJob(ExpiryJobSchema, job.data || {})
  const batchLimit = Number(limit || 100)
  const expired = await expireBatch(batchLimit)
  const expiredMemberships = await expireMembershipBatch(batchLimit)
  logger.info({ jobId: job.id, queue: 'expiry', expired, expiredMemberships }, 'expiry_done')
  return { expired, expiredMemberships }
}

export async function startExpiryWorker() {
  const [{ connection }, { expiryQueue }, { startQueueStatsLogger }] = await Promise.all([
    import('../queues/connection.mjs'),
    import('../queues/expiryQueue.mjs'),
    import('../_lib/queueStats.mjs'),
  ])

  startQueueStatsLogger({ logger, queueName: 'expiry', queue: expiryQueue })

  const worker = new Worker('expiry', processExpiryJob, { connection, concurrency: 1 })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, queue: 'expiry', err: String(err?.message || err) }, 'expiry_failed')
    logFailedJob({ jobId: job?.id, queue: 'expiry', payload: job?.data, error: String(err?.message || err) }).catch(() => {})
  })

  logger.info('expiryWorker started')
  return worker
}

// Only start the long-running worker when executed directly (not when imported by serverless routes).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startExpiryWorker()
}
