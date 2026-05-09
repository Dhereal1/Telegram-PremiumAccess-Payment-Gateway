import dns from 'dns'
import IORedis from 'ioredis'
import { getWorkerEnv } from './worker-env.mjs'
import { getWorkerLogger } from './logger.mjs'

let connection;
const log = getWorkerLogger()

try {
  dns.setDefaultResultOrder('ipv4first')
} catch {
  // ignore
}

export function getRedis() {
  if (connection) return connection;
  const env = getWorkerEnv();
  connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    family: 4,
    connectTimeout: 15_000,
  })

  connection.on('error', (err) => {
    log.error({ err: String(err?.message || err) }, 'redis_error')
  })

  return connection;
}
