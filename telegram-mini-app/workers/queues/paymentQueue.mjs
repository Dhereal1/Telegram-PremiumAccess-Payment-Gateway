import { Queue } from 'bullmq'
import { connection } from './connection.mjs'

export const paymentQueue = new Queue('payment-verification', {
  connection,
  defaultJobOptions: {
    attempts: 8,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000
  }
})

