import { setCors } from '../../lib/http.js'
import { getPool } from '../../lib/db.js'
import { getQueues } from '../../lib/queue.js'

function requireCronSecret(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    res.status(500).json({ error: 'Missing CRON_SECRET' })
    return false
  }
  const header = req.headers['x-cron-secret']
  const provided = Array.isArray(header) ? header[0] : header
  if (provided !== secret) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

async function safe(promise, label) {
  try {
    return { ok: true, value: await promise }
  } catch (e) {
    return { ok: false, error: `${label}: ${String(e?.message || e)}` }
  }
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!requireCronSecret(req, res)) return

  const startedAt = Date.now()

  const env = {
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasRedisUrl: Boolean(process.env.REDIS_URL),
    hasBotToken: Boolean(process.env.BOT_TOKEN),
    hasChannelId: Boolean(process.env.CHANNEL_ID),
    hasTonApiUrl: Boolean(process.env.TON_API_URL),
    hasTonApiKey: Boolean(process.env.TON_API_KEY),
    hasTonReceiver: Boolean(process.env.TON_RECEIVER_ADDRESS),
  }

  const pool = getPool()

  const dbCheck = await safe(pool.query('SELECT 1 as ok'), 'db')

  let queueStats = { ok: false, error: 'queues: not checked' }
  if (env.hasRedisUrl) {
    queueStats = await safe(
      (async () => {
        const { paymentVerificationQueue, accessGrantQueue, notificationQueue } = getQueues()
        const [pv, ag, nf] = await Promise.all([
          paymentVerificationQueue.getJobCounts(),
          accessGrantQueue.getJobCounts(),
          notificationQueue.getJobCounts(),
        ])
        return { paymentVerification: pv, accessGrant: ag, notification: nf }
      })(),
      'queues',
    )
  }

  const durationMs = Date.now() - startedAt
  return res.json({
    ok: dbCheck.ok && queueStats.ok,
    timestamp: new Date().toISOString(),
    durationMs,
    env,
    db: dbCheck.ok ? { ok: true } : { ok: false, error: dbCheck.error },
    queues: queueStats.ok ? { ok: true, counts: queueStats.value } : { ok: false, error: queueStats.error },
  })
}

