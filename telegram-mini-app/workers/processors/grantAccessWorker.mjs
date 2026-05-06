import { Worker } from 'bullmq'
import { connection } from '../queues/connection.mjs'
import { getWorkerLogger } from '../_lib/logger.mjs'

import { getUserById } from '../../services/user.service.mjs'
import { markAccessGrantedIfNotExists, unmarkAccessGranted } from '../../services/subscription.service.mjs'
import { createInviteLink, sendMessage } from '../../services/telegram.service.mjs'
import { logFailedJob } from '../_lib/failedJobs.mjs'

const logger = getWorkerLogger()

const worker = new Worker(
  'access-grant',
  async (job) => {
    const { userId, telegramId } = job.data || {}

    logger.info({ jobId: job.id, userId }, 'access_grant_processing')

    const user = await getUserById(userId)
    if (!user) {
      logger.warn({ jobId: job.id, userId }, 'access_grant_user_not_found')
      return
    }

    if (!user.payment_status) {
      logger.warn({ jobId: job.id, userId }, 'access_grant_not_paid')
      return
    }

    // Atomic claim to prevent duplicate invites under concurrency.
    const claimed = await markAccessGrantedIfNotExists(userId)
    if (!claimed) {
      logger.info({ jobId: job.id, userId }, 'access_grant_already_claimed')
      return
    }

    try {
      const inviteLink = await createInviteLink({ memberLimit: 1, expireSeconds: 3600 })
      await sendMessage(telegramId, `✅ Payment confirmed!\n\nJoin here:\n${inviteLink}`)
    } catch (e) {
      // Roll back claim so retries can attempt again.
      await unmarkAccessGranted(userId)
      throw e
    }

    logger.info({ jobId: job.id, userId }, 'access_grant_success')
  },
  { connection, concurrency: 5 }
)

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: String(err?.message || err) }, 'access_grant_failed')
  logFailedJob({
    jobId: job?.id,
    queue: 'access-grant',
    payload: job?.data,
    error: String(err?.message || err)
  }).catch(() => {})
})

export default worker
