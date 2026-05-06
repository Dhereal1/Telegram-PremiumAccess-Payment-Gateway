import { expiryQueue } from '../queues/expiryQueue.mjs'
import { getWorkerLogger } from '../_lib/logger.mjs'

const logger = getWorkerLogger()

async function tick() {
  const jobId = `expiry:${Math.floor(Date.now() / 60000)}`
  try {
    await expiryQueue.add('expire', { limit: 200 }, { jobId })
    logger.info({ queue: 'expiry', jobId }, 'expiry_job_enqueued')
  } catch (e) {
    // If multiple schedulers run, the first one wins; ignore duplicates.
    const msg = String(e?.message || e)
    if (msg.toLowerCase().includes('job') && msg.toLowerCase().includes('exists')) {
      logger.info({ queue: 'expiry', jobId }, 'expiry_job_already_enqueued')
      return
    }
    throw e
  }
}

async function main() {
  const intervalMs = Number(process.env.EXPIRY_SCHEDULER_INTERVAL_MS || '60000')
  logger.info({ intervalMs }, 'expiryScheduler started')
  while (true) {
    try {
      await tick()
    } catch (e) {
      logger.error({ err: String(e?.message || e) }, 'expiryScheduler failed')
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

main()
