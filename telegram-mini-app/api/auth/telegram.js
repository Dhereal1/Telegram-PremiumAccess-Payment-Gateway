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
  const botToken = process.env.BOT_TOKEN;
  const maxAgeSeconds = 300;

  const verify = verifyTelegramData(initData, botToken, { maxAgeSeconds });
  if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason });

  const tgUser = parseTelegramUser(initData);
  if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user in initData' });

  const pool = getPool();

  const result = await pool.query(
    `INSERT INTO users (telegram_id, username, first_name, last_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (telegram_id)
     DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name
     RETURNING *`,
    [String(tgUser.id), tgUser.username ?? null, tgUser.first_name ?? null, tgUser.last_name ?? null],
  );

  return res.json({ user: result.rows[0] });
}
