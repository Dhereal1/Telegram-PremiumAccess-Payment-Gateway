import crypto from 'crypto'

export async function logFraud({ pool, telegramId, groupId, paymentIntentId, txHash, reason, metadata }) {
  try {
    if (!pool) return
    await pool.query(
      `INSERT INTO fraud_logs (id, telegram_id, group_id, payment_intent_id, tx_hash, reason, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [
        crypto.randomUUID(),
        telegramId != null ? String(telegramId) : null,
        groupId != null ? String(groupId) : null,
        paymentIntentId != null ? String(paymentIntentId) : null,
        txHash != null ? String(txHash) : null,
        String(reason || 'unknown'),
        metadata ? JSON.stringify(metadata) : null,
      ],
    )
  } catch {
    // best-effort
  }
}

