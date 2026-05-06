import { Worker } from 'bullmq'
import { pathToFileURL } from 'node:url'
import { getWorkerLogger } from '../_lib/logger.mjs'

import { getUserById } from '../../services/user.service.mjs'
import { markAccessGrantedIfNotExists, setInviteInfo, unmarkAccessGranted } from '../../services/subscription.service.mjs'
import { createInviteLink, sendMessage } from '../../services/telegram.service.mjs'
import { logFailedJob } from '../_lib/failedJobs.mjs'
import { logEvent } from '../../services/subscriptionEvents.service.mjs'
import { AccessGrantJobSchema, parseJob } from '../_lib/jobSchemas.mjs'

const logger = getWorkerLogger()

export async function processAccessGrantJob(job) {
  const { userId, telegramId, forceRegenerate } = parseJob(AccessGrantJobSchema, job.data || {})

  logger.info({ jobId: job.id, queue: 'access-grant', userId }, 'access_grant_processing')

  const user = await getUserById(userId)
  if (!user) {
    logger.warn({ jobId: job.id, queue: 'access-grant', userId }, 'access_grant_user_not_found')
    return
  }

  if (!user.payment_status) {
    logger.warn({ jobId: job.id, queue: 'access-grant', userId }, 'access_grant_not_paid')
    return
  }

  // Atomic claim to prevent duplicate invites under concurrency (unless forced regeneration).
  const claimed = forceRegenerate ? user : await markAccessGrantedIfNotExists(userId)
  if (!claimed) {
    logger.info({ jobId: job.id, queue: 'access-grant', userId }, 'access_grant_already_claimed')
    return
  }

  try {
    if (forceRegenerate) {
      await logEvent({ userId: String(claimed.telegram_id), type: 'invite_regen_requested', metadata: {} }).catch(() => {})
    }

    const inviteLink = await createInviteLink({ memberLimit: 1, expireSeconds: 3600 })
    await setInviteInfo({ userId, inviteLink })
    await logEvent({ userId: String(claimed.telegram_id), type: 'invite_sent', metadata: { inviteLink } })

    await sendMessage(telegramId, `✅ Payment confirmed!\n\nJoin here:\n${inviteLink}`)
    if (!forceRegenerate) await logEvent({ userId: String(claimed.telegram_id), type: 'access_granted', metadata: {} })
  } catch (e) {
    await logEvent({ userId: String(claimed.telegram_id), type: 'invite_failed', metadata: { error: String(e?.message || e) } }).catch(() => {})
    // Roll back claim so retries can attempt again.
    if (!forceRegenerate) await unmarkAccessGranted(userId)
    throw e
  }

  logger.info({ jobId: job.id, queue: 'access-grant', userId }, 'access_grant_success')
}

export async function startGrantAccessWorker() {
  const [{ connection }, { accessQueue }, { startQueueStatsLogger }] = await Promise.all([
    import('../queues/connection.mjs'),
    import('../queues/accessQueue.mjs'),
    import('../_lib/queueStats.mjs'),
  ])

  startQueueStatsLogger({ logger, queueName: 'access-grant', queue: accessQueue })

  const worker = new Worker('access-grant', processAccessGrantJob, { connection, concurrency: 5 })

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, queue: 'access-grant', userId: job?.data?.userId, err: String(err?.message || err) },
      'access_grant_failed',
    )
    logFailedJob({
      jobId: job?.id,
      queue: 'access-grant',
      payload: job?.data,
      error: String(err?.message || err),
    }).catch(() => {})
  })

  logger.info('grantAccessWorker started')
  return worker
}

// Only start the long-running worker when executed directly (not when imported by serverless routes).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startGrantAccessWorker()
}
