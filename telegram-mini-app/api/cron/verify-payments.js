import { getPool } from '../_lib/db.js';
import { requireCronAuth, setCors } from '../_lib/http.js';
import {
  extractTelegramIdFromComment,
  getTransactions,
  getTxCursor,
  isValidIncomingPayment,
  parseCommentFromTx,
} from '../_lib/toncenter.js';
import { createInviteLink, sendAccessMessage } from '../_lib/telegram-bot.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = requireCronAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

  const receiverAddress = process.env.TON_RECEIVER_ADDRESS;
  const priceTon = Number(process.env.TON_PRICE_TON || '0.1');
  const apiUrl = process.env.TON_API_URL || 'https://toncenter.com/api/v2';
  const apiKey = process.env.TON_API_KEY || '';
  const botToken = process.env.BOT_TOKEN || '';
  const channelId = process.env.CHANNEL_ID || '';

  if (!receiverAddress) return res.status(500).json({ error: 'Missing TON_RECEIVER_ADDRESS' });

  const pool = getPool();

  const stateKeyPrefix = `ton:${receiverAddress}:`;
  const lastLtRow = await pool.query('SELECT value FROM verifier_state WHERE key = $1', [`${stateKeyPrefix}last_lt`]);
  const lastHashRow = await pool.query('SELECT value FROM verifier_state WHERE key = $1', [`${stateKeyPrefix}last_hash`]);
  const lastLt = lastLtRow.rows[0]?.value || null;
  const lastHash = lastHashRow.rows[0]?.value || null;

  const pageLimit = Number(process.env.TON_TX_PAGE_LIMIT || '50');
  const maxPages = Number(process.env.TON_TX_MAX_PAGES || '8');

  const collected = [];
  let pageLt = null;
  let pageHash = null;

  for (let page = 0; page < maxPages; page++) {
    const pageTxs = await getTransactions({
      apiUrl,
      apiKey,
      address: receiverAddress,
      limit: pageLimit,
      ...(pageLt && pageHash ? { lt: pageLt, hash: pageHash } : {}),
    });

    if (!Array.isArray(pageTxs) || pageTxs.length === 0) break;

    let slice = pageTxs;
    if (lastLt && lastHash) {
      const idx = pageTxs.findIndex((t) => t?.transaction_id?.lt === lastLt && t?.transaction_id?.hash === lastHash);
      if (idx >= 0) {
        slice = pageTxs.slice(0, idx);
        collected.push(...slice);
        break;
      }
    }

    collected.push(...slice);

    // Prepare next page cursor (oldest tx in this page)
    const lastTx = pageTxs[pageTxs.length - 1];
    const cursor = getTxCursor(lastTx);
    if (!cursor) break;
    pageLt = cursor.lt;
    pageHash = cursor.hash;

    if (pageTxs.length < pageLimit) break;
  }

  // TON Center returns newest first; process oldest -> newest
  const txs = collected.slice().reverse();
  const newestSeen = collected.length ? getTxCursor(collected[0]) : null;

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

  // Update checkpoint to the newest tx we have seen (even if ignored), to avoid re-fetching it.
  if (newestSeen?.lt && newestSeen?.hash) {
    await pool.query(
      `INSERT INTO verifier_state (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [`${stateKeyPrefix}last_lt`, newestSeen.lt],
    );
    await pool.query(
      `INSERT INTO verifier_state (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [`${stateKeyPrefix}last_hash`, newestSeen.hash],
    );
  }

  return res.json({ ok: true, processed, confirmed, accessGranted, skipped, receiverAddress, priceTon });
}
