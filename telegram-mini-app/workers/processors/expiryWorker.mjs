import { Worker } from 'bullmq'
import { connection } from '../queues/connection.mjs'
import { getWorkerLogger } from '../_lib/logger.mjs'
import { getDb } from '../_lib/db.mjs'
import { logEvent } from '../../services/subscriptionEvents.service.mjs'
import { logFailedJob } from '../_lib/failedJobs.mjs'
import { expiryQueue } from '../queues/expiryQueue.mjs'
import { startQueueStatsLogger } from '../_lib/queueStats.mjs'

const logger = getWorkerLogger()
const pool = getDb()
startQueueStatsLogger({ logger, queueName: 'expiry', queue: expiryQueue })

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

  for (const row of res.rows) {
    await pool.query(
      `UPDATE users
       SET payment_status=false, access_granted=false, subscription_status='expired'
       WHERE id=$1`,
      [row.id],
    )

    await logEvent({ userId: String(row.telegram_id), type: 'subscription_expired', metadata: {} })
    await logEvent({ userId: String(row.telegram_id), type: 'access_revoked', metadata: {} })
  }

  return res.rows.length
}

const worker = new Worker(
  'expiry',
  async (job) => {
    const limit = Number(job.data?.limit || 100)
    const expired = await expireBatch(limit)
    logger.info({ jobId: job.id, queue: 'expiry', expired }, 'expiry_done')
    return { expired }
  },
  { connection, concurrency: 1 },
)

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, queue: 'expiry', err: String(err?.message || err) }, 'expiry_failed')
  logFailedJob({ jobId: job?.id, queue: 'expiry', payload: job?.data, error: String(err?.message || err) }).catch(() => {})
})

export default worker
