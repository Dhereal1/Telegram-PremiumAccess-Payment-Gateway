import { getQueues } from '../../lib/queue.js'
import { setCors } from '../../lib/http.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const secret = process.env.CRON_SECRET
  if (!secret) return res.status(500).json({ error: 'Missing CRON_SECRET' })
  const header = req.headers['x-cron-secret']
  const provided = Array.isArray(header) ? header[0] : header
  if (provided !== secret) return res.status(401).json({ error: 'Unauthorized' })

  const { paymentVerificationQueue, accessGrantQueue, notificationQueue } = getQueues()

  const pv = await paymentVerificationQueue.retryJobs({ count: 1000 })
  const ag = await accessGrantQueue.retryJobs({ count: 1000 })
  const nt = await notificationQueue.retryJobs({ count: 1000 })

  return res.json({ ok: true, retried: { paymentVerificationQueue: pv, accessGrantQueue: ag, notificationQueue: nt } })
}
