import { getPool } from '../../../lib/db.js'
import { setCors } from '../../../lib/http.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const telegramId = req.query?.telegram_id
  if (!telegramId) return res.status(400).json({ error: 'Missing telegram_id' })
  const groupId = req.query?.groupId || req.query?.group_id || null

  const pool = getPool()
  const result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [String(telegramId)])

  if (result.rows.length === 0) return res.json({ exists: false })
  const user = result.rows[0]

  if (groupId) {
    const m = await pool.query('SELECT * FROM memberships WHERE group_id=$1 AND telegram_id=$2', [String(groupId), String(telegramId)])
    const membership = m.rows[0] || null
    return res.json({
      exists: true,
      groupId: String(groupId),
      paid: Boolean(membership?.payment_status),
      expiry: membership?.expiry_date || null,
      accessGranted: Boolean(membership?.access_granted),
      membership,
      user,
    })
  }

  return res.json({
    exists: true,
    paid: Boolean(user.payment_status),
    expiry: user.expiry_date,
    user,
  })
}
