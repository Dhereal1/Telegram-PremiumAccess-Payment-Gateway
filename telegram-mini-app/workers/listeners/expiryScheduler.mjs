import { expiryQueue } from '../queues/expiryQueue.mjs'
import { getWorkerLogger } from '../_lib/logger.mjs'

const logger = getWorkerLogger()

async function tick() {
  await expiryQueue.add('expire', { limit: 200 }, { jobId: `expiry:${Math.floor(Date.now() / 60000)}` })
  logger.info({ queue: 'expiry' }, 'expiry_job_enqueued')
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
