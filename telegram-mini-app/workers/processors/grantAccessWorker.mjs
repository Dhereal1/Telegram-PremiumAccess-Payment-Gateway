import { Worker } from 'bullmq'
import { connection } from '../queues/connection.mjs'
import { getWorkerLogger } from '../_lib/logger.mjs'
import { accessQueue } from '../queues/accessQueue.mjs'
import { startQueueStatsLogger } from '../_lib/queueStats.mjs'

import { getUserById } from '../../services/user.service.mjs'
import { markAccessGrantedIfNotExists, setInviteInfo, unmarkAccessGranted } from '../../services/subscription.service.mjs'
import { createInviteLink, sendMessage } from '../../services/telegram.service.mjs'
import { logFailedJob } from '../_lib/failedJobs.mjs'
import { logEvent } from '../../services/subscriptionEvents.service.mjs'

const logger = getWorkerLogger()
startQueueStatsLogger({ logger, queueName: 'access-grant', queue: accessQueue })

const worker = new Worker(
  'access-grant',
  async (job) => {
    const { userId, telegramId, forceRegenerate } = job.data || {}

    logger.info({ jobId: job.id, queue: 'access-grant', userId }, 'access_grant_processing')

    const user = await getUserById(userId)
    if (!user) {
      logger.warn({ jobId: job.id, queue: 'access-grant', userId }, 'access_grant_user_not_found')
      return
    }

    if (!user.payment_status) {
      logger.warn({ jobId: job.id, userId }, 'access_grant_not_paid')
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
  },
  { connection, concurrency: 5 }
)

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, queue: 'access-grant', userId: job?.data?.userId, err: String(err?.message || err) }, 'access_grant_failed')
  logFailedJob({
    jobId: job?.id,
    queue: 'access-grant',
    payload: job?.data,
    error: String(err?.message || err)
  }).catch(() => {})
})

export default worker
