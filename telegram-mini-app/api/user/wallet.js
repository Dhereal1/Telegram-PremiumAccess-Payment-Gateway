import { getPool } from '../_lib/db.js';
import { setCors, readJson } from '../_lib/http.js';
import { verifyTelegramData, parseTelegramUser } from '../_lib/telegram.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = await readJson(req);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const initData = body?.initData;
  const walletAddress = body?.wallet_address;
  if (!walletAddress || typeof walletAddress !== 'string') {
    return res.status(400).json({ error: 'Missing wallet_address' });
  }

  const botToken = process.env.BOT_TOKEN;
  const maxAgeSeconds = Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || '86400');
  const verify = verifyTelegramData(initData, botToken, { maxAgeSeconds });
  if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason });

  const tgUser = parseTelegramUser(initData);
  if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user in initData' });

  const pool = getPool();
  const result = await pool.query(
    `UPDATE users
     SET wallet_address = $1
     WHERE telegram_id = $2
     RETURNING *`,
    [walletAddress, String(tgUser.id)],
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found. Call /api/auth/telegram first.' });
  }

  return res.json({ success: true, user: result.rows[0] });
}
