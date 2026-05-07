import { z } from 'zod';
import dotenv from 'dotenv';

// Load local env when running workers on a laptop/VM.
// This is a no-op in environments where vars are already provided (dotenv does not override by default).
dotenv.config({ path: new URL('../../.env', import.meta.url) });

const WorkerEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  BOT_TOKEN: z.string().min(1),
  CHANNEL_ID: z.string().optional(),

  TON_RECEIVER_ADDRESS: z.string().min(1),
  TON_PRICE_TON: z.string().default('0.1'),
  TON_API_URL: z.string().default('https://toncenter.com/api/v2'),
  TON_API_KEY: z.string().optional(),

  TELEGRAM_AUTH_MAX_AGE_SECONDS: z.string().optional(),

  LOG_LEVEL: z.string().optional(),
});

export function getWorkerEnv() {
  const parsed = WorkerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid worker env: ${msg}`);
  }
  return parsed.data;
}
