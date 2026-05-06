import { Queue } from 'bullmq'
import { connection } from './connection.mjs'

export const notificationQueue = new Queue('notification', {
  connection,
  limiter: { max: 100, duration: 1000 },
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: false
  }
})
