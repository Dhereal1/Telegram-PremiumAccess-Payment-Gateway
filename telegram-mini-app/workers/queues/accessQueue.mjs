import { Queue } from 'bullmq'
import { connection } from './connection.mjs'

export const accessQueue = new Queue('access-grant', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: false
  }
})

