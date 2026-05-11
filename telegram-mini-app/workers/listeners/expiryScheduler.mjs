import { expiryQueue } from '../queues/expiryQueue.mjs'
import { getWorkerLogger } from '../_lib/logger.mjs'

const logger = getWorkerLogger()
let running = true

process.on('unhandledRejection', (e) => logger.error({ err: String(e?.message || e) }, 'unhandledRejection'))
process.on('uncaughtException', (e) => logger.error({ err: String(e?.message || e) }, 'uncaughtException'))

async function tick() {
  // BullMQ does not allow ':' in custom job ids.
  const jobId = `expiry_${Math.floor(Date.now() / 60000)}`
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
  while (running) {
    try {
      await tick()
    } catch (e) {
      logger.error({ err: String(e?.message || e) }, 'expiryScheduler failed')
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

const p = main()
async function shutdown(signal) {
  running = false
  logger.info({ signal }, 'worker_shutdown_start')
  setTimeout(() => process.exit(0), 10_000).unref?.()
  try {
    await p
  } catch {
    // ignore
  }
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
