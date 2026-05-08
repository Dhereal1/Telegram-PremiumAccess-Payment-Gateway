import { Queue } from 'bullmq'
import dns from 'dns'
import IORedis from 'ioredis'
import { requireRedisUrl } from './env.js'
import { getLogger } from './log.js'

let connection
let queues
const log = getLogger()

// Prefer IPv4 to reduce transient DNS failures to hosted Redis on some networks.
try {
  dns.setDefaultResultOrder('ipv4first')
} catch {
  // ignore
}

function getConnection() {
  if (connection) return connection
  const redisUrl = requireRedisUrl()
  connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    family: 4,
    connectTimeout: 15_000,
  })
  // Prevent unhandled 'error' events from crashing the function runtime.
  connection.on('error', (err) => {
    log.error({ err: String(err?.message || err) }, 'redis_error')
  })
  return connection
}

export function getQueues() {
  if (queues) return queues
  const connection = getConnection()
  queues = {
    paymentVerificationQueue: new Queue('payment-verification', { connection }),
    accessGrantQueue: new Queue('access-grant', { connection }),
    notificationQueue: new Queue('notification', { connection }),
  }
  return queues
}
