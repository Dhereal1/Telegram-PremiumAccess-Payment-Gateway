import { getPool } from '../_lib/db.js';
import { requireCronAuth, setCors } from '../_lib/http.js';
import { createInviteLink, sendMessage } from '../../services/telegram.service.mjs';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = requireCronAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

  // This legacy endpoint does direct DB + Telegram side effects. Prefer `/api/internal/run-workers`.
  if (process.env.ENABLE_LEGACY_CRON !== '1') {
    return res.status(410).json({ error: 'Deprecated. Use /api/internal/run-workers instead.' });
  }

  if (!process.env.BOT_TOKEN) return res.status(500).json({ error: 'Missing BOT_TOKEN' });
  if (!process.env.CHANNEL_ID) return res.status(500).json({ error: 'Missing CHANNEL_ID' });

  const pool = getPool();

  // Optional expiry housekeeping
  await pool.query(
    `UPDATE users
     SET payment_status = false, access_granted = false
     WHERE expiry_date IS NOT NULL AND expiry_date < NOW()`,
  );

  const batchSize = Number(process.env.ACCESS_GRANT_BATCH_SIZE || '25');
  const users = await pool.query(
    `SELECT telegram_id
     FROM users
     WHERE payment_status = true
       AND access_granted = false
     ORDER BY created_at ASC
     LIMIT $1`,
    [batchSize],
  );

  let granted = 0;
  let skipped = 0;
  const errors = [];

  for (const row of users.rows) {
    const telegramId = row.telegram_id;
    if (!telegramId) {
      skipped++;
      continue;
    }

    try {
      const inviteLink = await createInviteLink({ memberLimit: 1, expireSeconds: 3600 });
      await sendMessage(telegramId, `✅ Payment confirmed!\n\n🎉 Join your premium access:\n${inviteLink}`);

      await pool.query('UPDATE users SET access_granted = true WHERE telegram_id = $1', [String(telegramId)]);
      granted++;
    } catch (e) {
      errors.push({ telegramId, error: String(e?.message || e) });
      // Do not flip access_granted on failure; retry next cron run.
    }
  }

  return res.json({ ok: true, scanned: users.rows.length, granted, skipped, errors });
}

