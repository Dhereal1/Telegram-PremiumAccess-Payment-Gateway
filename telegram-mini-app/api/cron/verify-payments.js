import { getPool } from '../_lib/db.js';
import { setCors } from '../_lib/http.js';
import {
  extractTelegramIdFromComment,
  getTransactions,
  isValidIncomingPayment,
  parseCommentFromTx,
} from '../_lib/toncenter.js';
import { createInviteLink, sendAccessMessage } from '../_lib/telegram-bot.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const receiverAddress = process.env.TON_RECEIVER_ADDRESS;
  const priceTon = Number(process.env.TON_PRICE_TON || '0.1');
  const apiUrl = process.env.TON_API_URL || 'https://toncenter.com/api/v2';
  const apiKey = process.env.TON_API_KEY || '';
  const botToken = process.env.BOT_TOKEN || '';
  const channelId = process.env.CHANNEL_ID || '';

  if (!receiverAddress) return res.status(500).json({ error: 'Missing TON_RECEIVER_ADDRESS' });

  const pool = getPool();

  const txs = await getTransactions({ apiUrl, apiKey, address: receiverAddress, limit: 20 });

  let processed = 0;
  let confirmed = 0;
  let skipped = 0;
  let accessGranted = 0;

  for (const tx of txs) {
    const txHash = tx?.transaction_id?.hash || tx?.in_msg?.hash || tx?.hash;
    if (!txHash) {
      skipped++;
      continue;
    }

    const exists = await pool.query('SELECT 1 FROM processed_transactions WHERE tx_hash = $1', [String(txHash)]);
    if (exists.rows.length) {
      skipped++;
      continue;
    }

    processed++;

    const valid = isValidIncomingPayment(tx, { receiverAddress, minTon: priceTon });
    if (!valid.ok) {
      await pool.query('INSERT INTO processed_transactions (tx_hash, status, reason) VALUES ($1, $2, $3)', [
        String(txHash),
        'ignored',
        valid.reason,
      ]);
      continue;
    }

    const comment = parseCommentFromTx(tx);
    const telegramId = extractTelegramIdFromComment(comment);
    if (!telegramId) {
      await pool.query('INSERT INTO processed_transactions (tx_hash, status, reason) VALUES ($1, $2, $3)', [
        String(txHash),
        'ignored',
        'Missing telegram id in payload',
      ]);
      continue;
    }

    const update = await pool.query(
      `UPDATE users
       SET payment_status = true,
           expiry_date = GREATEST(COALESCE(expiry_date, NOW()), NOW()) + INTERVAL '30 days'
       WHERE telegram_id = $1
       RETURNING telegram_id`,
      [String(telegramId)],
    );

    if (!update.rows.length) {
      await pool.query('INSERT INTO processed_transactions (tx_hash, status, reason, telegram_id) VALUES ($1, $2, $3, $4)', [
        String(txHash),
        'ignored',
        'User not found',
        String(telegramId),
      ]);
      continue;
    }

    confirmed++;
    await pool.query(
      'INSERT INTO processed_transactions (tx_hash, status, reason, telegram_id) VALUES ($1, $2, $3, $4)',
      [String(txHash), 'confirmed', 'OK', String(telegramId)],
    );

    // Optional: immediately grant access after confirmation (best-effort)
    if (botToken && channelId) {
      try {
        const row = await pool.query('SELECT access_granted FROM users WHERE telegram_id = $1', [String(telegramId)]);
        if (row.rows.length && row.rows[0].access_granted !== true) {
          const inviteLink = await createInviteLink({ botToken, channelId, memberLimit: 1, expireSeconds: 3600 });
          await sendAccessMessage({ botToken, telegramId: String(telegramId), inviteLink });
          await pool.query('UPDATE users SET access_granted = true WHERE telegram_id = $1', [String(telegramId)]);
          accessGranted++;
        }
      } catch {
        // ignore and allow the dedicated grant-access cron to retry
      }
    }
  }

  return res.json({ ok: true, processed, confirmed, accessGranted, skipped, receiverAddress, priceTon });
}
