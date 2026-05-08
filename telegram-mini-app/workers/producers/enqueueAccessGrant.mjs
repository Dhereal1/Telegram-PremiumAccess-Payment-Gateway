import { accessQueue } from '../queues/accessQueue.mjs'

export async function enqueueAccessGrant({ userId, membershipId, groupId, telegramId }) {
  await accessQueue.add(
    'grant-access',
    { userId, membershipId, groupId, telegramId },
    // Idempotency: prefer membershipId when present (multi-tenant).
    { jobId: membershipId ? `accessm_${membershipId}` : `access_${userId}` }
  )
}
