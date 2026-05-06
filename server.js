require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { getPool } = require('./api/_lib/db');
const { verifyTelegramData, parseTelegramUser } = require('./api/_lib/telegram');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (req, res) => {
  try {
    await getPool().query('SELECT 1 as ok');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/auth/telegram', async (req, res) => {
  const { initData } = req.body || {};

  const maxAgeSeconds = Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || '86400');
  const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds });
  if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason });

  const user = parseTelegramUser(initData);
  if (!user?.id) return res.status(400).json({ error: 'Missing Telegram user in initData' });

  const result = await getPool().query(
    `INSERT INTO users (telegram_id, username, first_name, last_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (telegram_id)
     DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name
     RETURNING *`,
    [String(user.id), user.username ?? null, user.first_name ?? null, user.last_name ?? null],
  );

  res.json({ user: result.rows[0] });
});

app.get('/user/status/:telegram_id', async (req, res) => {
  const { telegram_id } = req.params;

  const result = await getPool().query('SELECT * FROM users WHERE telegram_id = $1', [String(telegram_id)]);
  if (result.rows.length === 0) return res.json({ exists: false });

  res.json({ exists: true, user: result.rows[0] });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));

