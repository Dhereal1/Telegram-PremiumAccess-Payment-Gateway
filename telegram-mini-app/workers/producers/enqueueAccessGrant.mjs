import { accessQueue } from '../queues/accessQueue.mjs'

export async function enqueueAccessGrant({ userId, membershipId, groupId, telegramId }) {
  const payload = {
    ...(userId != null ? { userId } : {}),
    ...(membershipId != null ? { membershipId } : {}),
    ...(groupId != null ? { groupId } : {}),
    telegramId,
  }
  await accessQueue.add(
    'grant-access',
    payload,
    // Idempotency: prefer membershipId when present (multi-tenant).
    { jobId: membershipId ? `accessm_${membershipId}` : `access_${userId}` }
  )
}
