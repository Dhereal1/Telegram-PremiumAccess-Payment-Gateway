import { z } from 'zod';

export function parseJson(body, schema) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    const err = new Error(`Invalid request: ${msg}`);
    err.statusCode = 400;
    throw err;
  }
  return parsed.data;
}

export const TelegramInitDataSchema = z.object({
  initData: z.string().min(1),
});

