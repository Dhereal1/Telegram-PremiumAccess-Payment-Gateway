import { Worker } from 'bullmq'
import { pathToFileURL } from 'node:url'
import { getWorkerLogger } from '../_lib/logger.mjs'

import { getMembershipById } from '../../services/user.service.mjs'
import { markMembershipAccessGrantedIfNotExists, setMembershipInviteInfo, unmarkMembershipAccessGranted } from '../../services/subscription.service.mjs'
import { createInviteLink, getChat, revokeInviteLink, sendMessage } from '../../services/telegram.service.mjs'
import { logFailedJob } from '../_lib/failedJobs.mjs'
import { logEvent } from '../../services/subscriptionEvents.service.mjs'
import { AccessGrantJobSchema, parseJob } from '../_lib/jobSchemas.mjs'
import { getPool } from '../../db/index.mjs'
import { chatComplete } from '../../server/lib/groq.js'

const logger = getWorkerLogger()

process.on('unhandledRejection', (e) => logger.error({ err: String(e?.message || e) }, 'unhandledRejection'))
process.on('uncaughtException', (e) => logger.error({ err: String(e?.message || e) }, 'uncaughtException'))

export async function processAccessGrantJob(job) {
  const { userId, membershipId, groupId, telegramId, forceRegenerate } = parseJob(AccessGrantJobSchema, job.data || {})

  logger.info({ jobId: job.id, queue: 'access-grant', userId, membershipId, groupId }, 'access_grant_processing')

  // Multi-tenant only: membership-based access per group
  if (!membershipId) {
    logger.warn({ jobId: job.id, queue: 'access-grant' }, 'access_grant_missing_membershipId')
    return
  }

  const membership = await getMembershipById(membershipId)
  if (!membership) {
    logger.warn({ jobId: job.id, queue: 'access-grant', membershipId }, 'access_grant_membership_not_found')
    return
  }
  if (!membership.payment_status) {
    logger.warn({ jobId: job.id, queue: 'access-grant', membershipId }, 'access_grant_not_paid')
    return
  }

  const pool = getPool()
  const g = await pool.query('SELECT id, telegram_chat_id, name, price_ton, duration_days FROM groups WHERE id=$1', [String(membership.group_id)])
  const chatId = g.rows[0]?.telegram_chat_id
  if (!chatId) {
    logger.warn({ jobId: job.id, queue: 'access-grant', membershipId }, 'access_grant_group_not_found')
    return
  }
  const group = g.rows[0]

  let claimed = null
  if (forceRegenerate) {
    // Put the membership in a clean state for regen; mark back to true after success.
    await unmarkMembershipAccessGranted(membershipId).catch(() => {})
    claimed = membership
  } else {
    claimed = await markMembershipAccessGrantedIfNotExists(membershipId)
    if (!claimed) {
      logger.info({ jobId: job.id, queue: 'access-grant', membershipId }, 'access_grant_already_claimed')
      return
    }
  }

  try {
    if (forceRegenerate) {
      await logEvent({ userId: String(claimed.telegram_id), type: 'invite_regen_requested', metadata: {} }).catch(() => {})
    }

    // Verify group is still accessible before generating an invite link.
    try {
      await getChat({ chatId })
    } catch (e) {
      logger.error({ jobId: job.id, queue: 'access-grant', membershipId, chatId, err: String(e?.message || e) }, 'access_grant_group_inaccessible')
      throw e
    }

    // Revoke old invite link before creating a new one (security: prevent link sharing).
    const oldInviteLink = membership.last_invite_link
    if (oldInviteLink) {
      await revokeInviteLink({ chatId, inviteLink: oldInviteLink }).catch(() => {})
    }

    // Give users enough time to click/complete join flow (wallet delays, network issues, Telegram UI delays).
    const inviteLink = await createInviteLink({ chatId, memberLimit: 1, expireSeconds: 60 * 60 * 24 })
    await setMembershipInviteInfo({ membershipId, inviteLink })
    await logEvent({ userId: String(claimed.telegram_id), type: 'invite_sent', metadata: { inviteLink, groupId: String(membership.group_id) } })

    await sendMessage(telegramId, `✅ Payment confirmed!\n\nJoin here:\n${inviteLink}`).catch((e) => {
      logger.warn({ telegramId, err: String(e?.message || e), membershipId }, 'grant_access_dm_failed')
    })

    const aiCongrats = await chatComplete({
      system: `You are a friendly community assistant for \"${group?.name || 'this group'}\".\nWrite a short congratulations message (2 sentences) for a user who just subscribed. Tell them they now have access and to use the invite link. Be warm and welcoming.`,
      user: `User just paid ${String(group?.price_ton ?? '')} TON and got access to ${String(group?.name || 'this group')} for ${String(group?.duration_days ?? '')} days.`,
      maxTokens: 100,
    })
    if (aiCongrats) {
      await sendMessage(telegramId, aiCongrats).catch((e) => {
        logger.warn({ telegramId, err: String(e?.message || e), membershipId }, 'grant_access_ai_dm_failed')
      })
    }
    if (!forceRegenerate) await logEvent({ userId: String(claimed.telegram_id), type: 'access_granted', metadata: { groupId: String(membership.group_id) } })
    if (forceRegenerate) await markMembershipAccessGrantedIfNotExists(membershipId).catch(() => {})
  } catch (e) {
    await logEvent({ userId: String(claimed.telegram_id), type: 'invite_failed', metadata: { error: String(e?.message || e), groupId: String(membership.group_id) } }).catch(() => {})
    if (!forceRegenerate) await unmarkMembershipAccessGranted(membershipId)
    throw e
  }

  logger.info({ jobId: job.id, queue: 'access-grant', membershipId }, 'access_grant_success')

  // Notify admin of new subscriber (best-effort)
  try {
    const adminResult = await pool.query('SELECT admin_telegram_id FROM groups WHERE id=$1', [String(membership.group_id)])
    const adminTelegramId = adminResult.rows[0]?.admin_telegram_id
    if (adminTelegramId && String(adminTelegramId) !== String(telegramId)) {
      const webAppUrl = String(process.env.WEB_APP_URL || '').trim().replace(/\/+$/, '')
      const notificationText =
        `💰 New subscriber!\n\n` +
        `Someone just paid and joined *${group?.name || 'your group'}*.\n\n` +
        `💎 Amount: ${String(group?.price_ton ?? '')} TON\n` +
        `👥 Group: ${String(group?.name ?? '')}\n` +
        `📅 Duration: ${String(group?.duration_days ?? '')} days`

      await sendMessage(
        adminTelegramId,
        notificationText,
        webAppUrl
          ? {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [[{ text: '🛠 View Dashboard', web_app: { url: `${webAppUrl}/?admin=1` } }]],
              },
            }
          : { parse_mode: 'Markdown' },
      ).catch((e) => {
        logger.warn({ adminTelegramId, err: String(e?.message || e), membershipId }, 'admin_notification_failed')
      })
    }
  } catch {
    // best-effort, never block access grant
  }
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
  const worker = await startGrantAccessWorker()
  async function shutdown(signal) {
    logger.info({ signal }, 'worker_shutdown_start')
    try {
      await worker.close()
    } catch (e) {
      logger.warn({ err: String(e?.message || e) }, 'worker_shutdown_error')
    }
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
