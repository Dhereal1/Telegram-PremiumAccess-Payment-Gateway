import crypto from 'crypto';
import { getPool } from '../_lib/db.js';
import { setCors, readJson } from '../_lib/http.js';
import { getLogger } from '../_lib/log.js';
import { getRequestId } from '../_lib/request.js';
import { parseJson, TelegramInitDataSchema } from '../_lib/validation.js';
import { verifyTelegramData, parseTelegramUser } from '../_lib/telegram.js';
import { ipKey, rateLimit } from '../_lib/rate-limit.js';

const log = getLogger();

export default async function handler(req, res) {
  setCors(res);
  const requestId = getRequestId(req);
  res.setHeader('x-request-id', requestId);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Rate limit per IP to reduce intent-spam
    try {
      const rl = await rateLimit({ key: `pi:${ipKey(req)}`, limit: 30, windowSeconds: 60 });
      if (!rl.ok) return res.status(429).json({ error: 'Too many requests' });
    } catch {
      // If REDIS_URL not set, skip rate limiting (dev)
    }

    const body = await readJson(req);
    const { initData } = parseJson(body, TelegramInitDataSchema);

    const maxAgeSeconds = Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || '86400');
    const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds });
    if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason });

    const tgUser = parseTelegramUser(initData);
    if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user in initData' });

    const intentId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes

    const expectedTon = Number(process.env.TON_PRICE_TON || '0.1');
    const receiverAddress = process.env.TON_RECEIVER_ADDRESS;
    if (!receiverAddress) return res.status(500).json({ error: 'Missing TON_RECEIVER_ADDRESS' });

    const pool = getPool();

    await pool.query(
      `INSERT INTO payment_intents (id, telegram_id, expected_amount_ton, receiver_address, status, created_at, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW(), $5)`,
      [intentId, String(tgUser.id), expectedTon, receiverAddress, expiresAt.toISOString()],
    );

    const reference = `tp:${tgUser.id}|pi:${intentId}`;

    log.info({ requestId, intentId, telegramId: String(tgUser.id) }, 'payment_intent_created');
    return res.json({
      intentId,
      expectedAmountTon: expectedTon,
      receiverAddress,
      reference,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (e) {
    log.error({ requestId, err: String(e?.message || e) }, 'payment_intent_create_failed');
    const statusCode = e?.statusCode || 500;
    return res.status(statusCode).json({ error: 'Internal error' });
  }
}
