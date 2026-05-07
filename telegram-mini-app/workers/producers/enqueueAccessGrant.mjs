import { accessQueue } from '../queues/accessQueue.mjs'

export async function enqueueAccessGrant({ userId, telegramId }) {
  await accessQueue.add(
    'grant-access',
    { userId, telegramId },
    { jobId: `access_${userId}` }
  )
}
