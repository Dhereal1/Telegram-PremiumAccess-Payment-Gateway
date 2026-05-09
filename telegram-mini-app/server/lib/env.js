import { z } from 'zod'

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BOT_TOKEN: z.string().min(1),

  // Telegram / access control
  WEB_APP_URL: z.string().url().optional(),
  TELEGRAM_AUTH_MAX_AGE_SECONDS: z.string().optional(),

  // TON
  TON_API_URL: z.string().optional(),
  TON_API_KEY: z.string().optional(),

  // Queue (optional for routes that don't enqueue)
  REDIS_URL: z.string().optional(),

  // Optional auth for manual cron triggers / internal endpoints
  CRON_SECRET: z.string().optional(),

  // Platform fee
  PLATFORM_FEE_PERCENT: z.string().optional(),
  PLATFORM_WALLET_ADDRESS: z.string().optional(),

  // Optional AI (Groq)
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().optional(),
})

export function getEnv() {
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid env: ${message}`)
  }
  return parsed.data
}

export function requireRedisUrl() {
  const env = getEnv()
  if (!env.REDIS_URL) throw new Error('Missing REDIS_URL')
  return env.REDIS_URL
}
