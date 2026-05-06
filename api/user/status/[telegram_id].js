const { getPool } = require('../../_lib/db');
const { setCors } = require('../../_lib/http');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const telegramId = req.query?.telegram_id;
  if (!telegramId) return res.status(400).json({ error: 'Missing telegram_id' });

  const pool = getPool();
  const result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [String(telegramId)]);

  if (result.rows.length === 0) return res.json({ exists: false });
  return res.json({ exists: true, user: result.rows[0] });
};

