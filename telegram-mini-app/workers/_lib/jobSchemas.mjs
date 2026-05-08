import { z } from 'zod'

export const AccessGrantJobSchema = z.object({
  // Legacy: userId references users.id (single-tenant).
  userId: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
  // Multi-tenant: membershipId references memberships.id (uuid).
  membershipId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  telegramId: z.string().min(1),
  forceRegenerate: z.boolean().optional()
})

export const VerifyPaymentJobSchema = z.object({
  tx: z.any()
})

export const ExpiryJobSchema = z.object({
  limit: z.number().int().positive().optional()
})

export function parseJob(schema, data) {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    const err = new Error(`Invalid job data: ${msg}`)
    err.name = 'JobValidationError'
    throw err
  }
  return parsed.data
}
