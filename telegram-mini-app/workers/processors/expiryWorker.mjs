import { Worker } from 'bullmq'
import { pathToFileURL } from 'node:url'
import { getWorkerLogger } from '../_lib/logger.mjs'
import { getDb } from '../_lib/db.mjs'
import { logEvent } from '../../services/subscriptionEvents.service.mjs'
import { kickChatMember, revokeInviteLink, sendMessage } from '../../services/telegram.service.mjs'
import { logFailedJob } from '../_lib/failedJobs.mjs'
import { ExpiryJobSchema, parseJob } from '../_lib/jobSchemas.mjs'
import { getPool } from '../../db/index.mjs'
import { queryWithRetry } from '../_lib/queryRetry.mjs'
import { chatComplete } from '../../server/lib/groq.js'

const logger = getWorkerLogger()
const pool = getDb()

process.on('unhandledRejection', (e) => logger.error({ err: String(e?.message || e) }, 'unhandledRejection'))
process.on('uncaughtException', (e) => logger.error({ err: String(e?.message || e) }, 'uncaughtException'))

async function expireMembershipBatch(limit) {
  const res = await queryWithRetry(
    pool,
    `SELECT id, telegram_id, group_id, last_invite_link
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
    const upd = await queryWithRetry(
      pool,
      `UPDATE memberships
       SET payment_status=false,
           access_granted=false,
           subscription_status='expired',
           last_invite_link=NULL,
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

    // Best-effort: revoke any outstanding invite link and remove user from Telegram chat if bot is admin.
    try {
      const gp = getPool()
      const g = await gp.query('SELECT telegram_chat_id, id, name FROM groups WHERE id=$1', [String(groupId)])
      const chatId = g.rows[0]?.telegram_chat_id
      const groupName = g.rows[0]?.name || 'the group'
      const webAppUrl = String(process.env.WEB_APP_URL || '').trim().replace(/\/+$/, '')
      const reply_markup =
        webAppUrl && g.rows[0]?.id
          ? {
              inline_keyboard: [
                [
                  {
                    text: '🔄 Renew Now',
                    web_app: { url: `${webAppUrl}/?g=${encodeURIComponent(String(g.rows[0].id))}` },
                  },
                ],
              ],
            }
          : undefined

      if (chatId && row.last_invite_link) await revokeInviteLink({ chatId, inviteLink: String(row.last_invite_link) }).catch(() => {})
      if (chatId) await kickChatMember({ chatId, userId: telegramId })
      await sendMessage(
        telegramId,
        `⏰ Your subscription to ${groupName} has expired and your access has been removed.\n\nTap below to renew!`,
        reply_markup ? { reply_markup } : undefined,
      ).catch(() => {})
    } catch (e) {
      logger.warn({ telegramId: String(telegramId), groupId: String(groupId), err: String(e?.message || e) }, 'expiry_kick_failed')
    }
  }

  return expired
}

async function warnExpiringMembershipBatch(limit) {
  // Find memberships expiring in 1-3 days that haven't been warned yet.
  const res = await queryWithRetry(
    pool,
    `SELECT m.id, m.telegram_id, m.group_id, m.expiry_date
     FROM memberships m
     WHERE m.subscription_status = 'active'
       AND m.payment_status = true
       AND m.expiry_date IS NOT NULL
       AND m.expiry_warning_sent_at IS NULL
       AND m.expiry_date >= NOW() + INTERVAL '1 day'
       AND m.expiry_date <  NOW() + INTERVAL '4 days'
     ORDER BY m.expiry_date ASC
     LIMIT $1`,
    [limit],
  )

  if (!res.rows.length) return 0

  let warned = 0
  const gp = getPool()

  for (const row of res.rows) {
    // Claim the warning to avoid duplicates under concurrency.
    const claim = await queryWithRetry(
      pool,
      `UPDATE memberships
       SET expiry_warning_sent_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND expiry_warning_sent_at IS NULL
       RETURNING telegram_id, group_id, expiry_date`,
      [String(row.id)],
    )
    if (!claim.rows.length) continue

    const telegramId = claim.rows[0].telegram_id
    const groupId = claim.rows[0].group_id
    const expiryDate = new Date(claim.rows[0].expiry_date)
    const now = Date.now()
    const daysLeft = Math.max(1, Math.ceil((expiryDate.getTime() - now) / (24 * 60 * 60 * 1000)))

    try {
      const g = await gp.query('SELECT id, name FROM groups WHERE id=$1', [String(groupId)])
      const group = g.rows[0]
      const groupName = group?.name || 'your group'

      const aiWarning = await chatComplete({
        system: `You are a friendly assistant for \"${groupName}\".\nWrite a short, friendly renewal reminder (2 sentences) for a subscriber whose access expires soon.\nEncourage them to renew. Include the group name.`,
        user: `Subscription to ${groupName} expires in ${daysLeft} days. Write a renewal reminder.`,
        maxTokens: 100,
      })

      const text =
        aiWarning || `⏰ Your access to ${groupName} expires in ${daysLeft} days. Tap below to renew!`

      const webAppUrl = String(process.env.WEB_APP_URL || '').trim().replace(/\/+$/, '')
      const reply_markup =
        webAppUrl && group?.id
          ? {
              inline_keyboard: [
                [
                  {
                    text: '🔄 Renew Now',
                    web_app: { url: `${webAppUrl}/?g=${encodeURIComponent(String(group.id))}` },
                  },
                ],
              ],
            }
          : undefined

      await sendMessage(telegramId, text, reply_markup ? { reply_markup } : undefined)
      warned++
      await logEvent({ userId: String(telegramId), type: 'expiry_warning_sent', metadata: { groupId: String(groupId), daysLeft } }).catch(() => {})
    } catch (e) {
      // Allow retry later if sending fails.
      await queryWithRetry(
        pool,
        `UPDATE memberships SET expiry_warning_sent_at = NULL, updated_at = NOW() WHERE id = $1`,
        [String(row.id)],
        { attempts: 2 },
      ).catch(() => {})
      logger.warn({ telegramId: String(row.telegram_id), groupId: String(row.group_id), err: String(e?.message || e) }, 'expiry_warning_failed')
    }
  }

  return warned
}

export async function processExpiryJob(job) {
  const { limit } = parseJob(ExpiryJobSchema, job.data || {})
  const batchLimit = Number(limit || 100)
  const warnedMemberships = await warnExpiringMembershipBatch(batchLimit)
  const expiredMemberships = await expireMembershipBatch(batchLimit)
  logger.info({ jobId: job.id, queue: 'expiry', warnedMemberships, expiredMemberships }, 'expiry_done')
  return { warnedMemberships, expiredMemberships }
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
  const worker = await startExpiryWorker()
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
