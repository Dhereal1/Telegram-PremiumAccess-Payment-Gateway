import { Worker } from 'bullmq'
import { pathToFileURL } from 'node:url'
import { getWorkerLogger } from '../_lib/logger.mjs'

import { getMembershipById, getUserById } from '../../services/user.service.mjs'
import { markAccessGrantedIfNotExists, markMembershipAccessGrantedIfNotExists, setInviteInfo, setMembershipInviteInfo, unmarkAccessGranted, unmarkMembershipAccessGranted } from '../../services/subscription.service.mjs'
import { createInviteLink, sendMessage } from '../../services/telegram.service.mjs'
import { logFailedJob } from '../_lib/failedJobs.mjs'
import { logEvent } from '../../services/subscriptionEvents.service.mjs'
import { AccessGrantJobSchema, parseJob } from '../_lib/jobSchemas.mjs'
import { getPool } from '../../db/index.mjs'
import { chatComplete } from '../../server/lib/groq.js'

const logger = getWorkerLogger()

export async function processAccessGrantJob(job) {
  const { userId, membershipId, groupId, telegramId, forceRegenerate } = parseJob(AccessGrantJobSchema, job.data || {})

  logger.info({ jobId: job.id, queue: 'access-grant', userId, membershipId, groupId }, 'access_grant_processing')

  // Multi-tenant path: membership-based access per group
  if (membershipId) {
    const membership = await getMembershipById(membershipId)
    if (!membership) {
      logger.warn({ jobId: job.id, queue: 'access-grant', membershipId }, 'access_grant_membership_not_found')
      return
    }
    if (!membership.payment_status) {
      logger.warn({ jobId: job.id, queue: 'access-grant', membershipId }, 'access_grant_not_paid')
      return
    }

    // Load group for chat id
    const pool = getPool()
    const g = await pool.query('SELECT id, telegram_chat_id, name, price_ton, duration_days FROM groups WHERE id=$1', [String(membership.group_id)])
    const chatId = g.rows[0]?.telegram_chat_id
    if (!chatId) {
      logger.warn({ jobId: job.id, queue: 'access-grant', membershipId }, 'access_grant_group_not_found')
      return
    }
    const group = g.rows[0]

    const claimed = forceRegenerate ? membership : await markMembershipAccessGrantedIfNotExists(membershipId)
    if (!claimed) {
      logger.info({ jobId: job.id, queue: 'access-grant', membershipId }, 'access_grant_already_claimed')
      return
    }

  try {
      if (forceRegenerate) {
        await logEvent({ userId: String(claimed.telegram_id), type: 'invite_regen_requested', metadata: {} }).catch(() => {})
      }

      const inviteLink = await createInviteLink({ chatId, memberLimit: 1, expireSeconds: 600 })
      await setMembershipInviteInfo({ membershipId, inviteLink })
      await logEvent({ userId: String(claimed.telegram_id), type: 'invite_sent', metadata: { inviteLink, groupId: String(membership.group_id) } })

      await sendMessage(telegramId, `✅ Payment confirmed!\n\nJoin here:\n${inviteLink}`)
      // Optional AI congrats message (fails silently if Groq not configured).
      const aiCongrats = await chatComplete({
        system: `You are a friendly community assistant for \"${group?.name || 'this group'}\".\nWrite a short congratulations message (2 sentences) for a user who just subscribed. Tell them they now have access and to use the invite link. Be warm and welcoming.`,
        user: `User just paid ${String(group?.price_ton ?? '')} TON and got access to ${String(group?.name || 'this group')} for ${String(group?.duration_days ?? '')} days.`,
        maxTokens: 100,
      })
      if (aiCongrats) {
        await sendMessage(telegramId, aiCongrats).catch(() => {})
      }
      if (!forceRegenerate) await logEvent({ userId: String(claimed.telegram_id), type: 'access_granted', metadata: { groupId: String(membership.group_id) } })
  } catch (e) {
      await logEvent({ userId: String(claimed.telegram_id), type: 'invite_failed', metadata: { error: String(e?.message || e), groupId: String(membership.group_id) } }).catch(() => {})
      if (!forceRegenerate) await unmarkMembershipAccessGranted(membershipId)
      throw e
  }

    logger.info({ jobId: job.id, queue: 'access-grant', membershipId }, 'access_grant_success')
    return
  }

  // Legacy single-tenant path
  const user = await getUserById(userId)
  if (!user) {
    logger.warn({ jobId: job.id, queue: 'access-grant', userId }, 'access_grant_user_not_found')
    return
  }

  if (!user.payment_status) {
    logger.warn({ jobId: job.id, queue: 'access-grant', userId }, 'access_grant_not_paid')
    return
  }

  const claimed = forceRegenerate ? user : await markAccessGrantedIfNotExists(userId)
  if (!claimed) {
    logger.info({ jobId: job.id, queue: 'access-grant', userId }, 'access_grant_already_claimed')
    return
  }

  try {
    const inviteLink = await createInviteLink({ memberLimit: 1, expireSeconds: 600 })
    await setInviteInfo({ userId, inviteLink })
    await sendMessage(telegramId, `✅ Payment confirmed!\n\nJoin here:\n${inviteLink}`)
  } catch (e) {
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
