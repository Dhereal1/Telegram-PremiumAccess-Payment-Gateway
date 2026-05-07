import IORedis from 'ioredis'
import { getWorkerEnv } from '../_lib/worker-env.mjs'
import { getWorkerLogger } from '../_lib/logger.mjs'

const env = getWorkerEnv()
const log = getWorkerLogger()

export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

// Avoid unhandled 'error' events crashing the process.
connection.on('error', (err) => {
  log.error({ err: String(err?.message || err) }, 'redis_error')
})
