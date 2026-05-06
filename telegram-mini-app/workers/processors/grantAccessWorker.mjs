import { Worker } from 'bullmq'
import { connection } from '../queues/connection.mjs'
import { getWorkerLogger } from '../_lib/logger.mjs'

import { getUserById } from '../../services/user.service.mjs'
import { markAccessGranted } from '../../services/subscription.service.mjs'
import { createInviteLink, sendMessage } from '../../services/telegram.service.mjs'

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

    if (user.access_granted) {
      logger.info({ jobId: job.id, userId }, 'access_grant_already_granted')
      return
    }

    if (!user.payment_status) {
      logger.warn({ jobId: job.id, userId }, 'access_grant_not_paid')
      return
    }

    const inviteLink = await createInviteLink({ memberLimit: 1, expireSeconds: 3600 })
    await sendMessage(telegramId, `✅ Payment confirmed!\n\nJoin here:\n${inviteLink}`)
    await markAccessGranted(userId)

    logger.info({ jobId: job.id, userId }, 'access_grant_success')
  },
  { connection, concurrency: 5 }
)

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: String(err?.message || err) }, 'access_grant_failed')
})

export default worker
