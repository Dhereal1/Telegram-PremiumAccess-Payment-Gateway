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
    hasTonApiUrl: Boolean(process.env.TON_API_URL),
    hasTonApiKey: Boolean(process.env.TON_API_KEY),
  }

  const pool = getPool()

  const dbCheck = await safe(pool.query('SELECT 1 as ok'), 'db')

  let queueStats = { ok: false, error: 'queues: not checked' }
  if (env.hasRedisUrl) {
    queueStats = await safe(
      (async () => {
        const { paymentVerificationQueue, accessGrantQueue, notificationQueue } = getQueues()
        const results = await Promise.allSettled([
          paymentVerificationQueue.getJobCounts(),
          accessGrantQueue.getJobCounts(),
          notificationQueue.getJobCounts(),
        ])
        const counts = {
          paymentVerification: results[0].status === 'fulfilled' ? results[0].value : null,
          accessGrant: results[1].status === 'fulfilled' ? results[1].value : null,
          notification: results[2].status === 'fulfilled' ? results[2].value : null,
        }
        const errors = results
          .map((r, i) => (r.status === 'rejected' ? { queue: ['paymentVerification', 'accessGrant', 'notification'][i], error: String(r.reason?.message || r.reason) } : null))
          .filter(Boolean)
        return { counts, errors }
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
    queues: queueStats.ok
      ? { ok: queueStats.value?.errors?.length ? false : true, counts: queueStats.value?.counts, errors: queueStats.value?.errors || [] }
      : { ok: false, error: queueStats.error },
  })
}
