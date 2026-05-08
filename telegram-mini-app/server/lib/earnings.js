import { getPool } from './db.js'

export async function getAdminEarnings({ adminId, limit = 50 }) {
  const pool = getPool()

  const totals = await pool.query(
    `SELECT
       COALESCE(SUM(admin_amount), 0) AS total_earned,
       COALESCE(SUM(admin_amount) FILTER (WHERE status='paid'), 0) AS total_paid_out,
       COALESCE(SUM(admin_amount) FILTER (WHERE status='pending'), 0) AS pending_balance
     FROM earnings
     WHERE admin_id=$1`,
    [String(adminId)],
  )

  const txs = await pool.query(
    `SELECT id, group_id, payment_id, total_amount, platform_fee, admin_amount, status, created_at
     FROM earnings
     WHERE admin_id=$1
     ORDER BY created_at DESC
     LIMIT $2`,
    [String(adminId), Number(limit)],
  )

  const row = totals.rows[0] || {}
  return {
    total_earned: Number(row.total_earned || 0),
    total_paid_out: Number(row.total_paid_out || 0),
    pending_balance: Number(row.pending_balance || 0),
    transactions: txs.rows.map((t) => ({
      id: t.id,
      group_id: t.group_id,
      payment_id: t.payment_id,
      total_amount: Number(t.total_amount),
      platform_fee: Number(t.platform_fee),
      admin_amount: Number(t.admin_amount),
      status: t.status,
      created_at: t.created_at,
    })),
  }
}

export async function requestAdminPayout({ adminId }) {
  const pool = getPool()
  const r = await pool.query(
    `UPDATE earnings
     SET status='processing'
     WHERE admin_id=$1 AND status='pending'
     RETURNING id`,
    [String(adminId)],
  )
  return { updated: r.rows.length }
}

