import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BOT_TOKEN: z.string().min(1),

  // Telegram / access control
  WEB_APP_URL: z.string().url().optional(),
  CHANNEL_ID: z.string().optional(),
  TELEGRAM_AUTH_MAX_AGE_SECONDS: z.string().optional(),

  // TON
  TON_RECEIVER_ADDRESS: z.string().optional(),
  TON_PRICE_TON: z.string().optional(),
  TON_API_URL: z.string().optional(),
  TON_API_KEY: z.string().optional(),

  // Queue
  REDIS_URL: z.string().min(1),

  // Optional auth for manual cron triggers / internal endpoints
  CRON_SECRET: z.string().optional(),
});

export function getEnv() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid env: ${message}`);
  }
  return parsed.data;
}

