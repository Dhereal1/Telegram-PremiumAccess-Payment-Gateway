import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { requireRedisUrl } from './env.js'
import { getLogger } from './log.js'

let connection
let queues
const log = getLogger()

function getConnection() {
  if (connection) return connection
  const redisUrl = requireRedisUrl()
  connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
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
