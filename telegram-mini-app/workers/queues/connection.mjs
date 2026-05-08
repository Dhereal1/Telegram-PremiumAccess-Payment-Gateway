import dns from 'dns'
import IORedis from 'ioredis'
import { getWorkerEnv } from '../_lib/worker-env.mjs'
import { getWorkerLogger } from '../_lib/logger.mjs'

// Prefer IPv4 to reduce transient DNS failures (e.g. `getaddrinfo EAI_AGAIN`) to hosted Redis on some networks.
try {
  dns.setDefaultResultOrder('ipv4first')
} catch {
  // ignore
}

const env = getWorkerEnv()
const log = getWorkerLogger()

export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  family: 4,
  connectTimeout: 15_000,
})

// Avoid unhandled 'error' events crashing the process.
connection.on('error', (err) => {
  log.error({ err: String(err?.message || err) }, 'redis_error')
})
