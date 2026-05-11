require('dotenv').config({path:'./.env', override:true});
const { Pool } = require('pg');
const Redis = require('ioredis');

async function reset() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pool.query(`
    TRUNCATE TABLE 
      subscription_events, memberships, payments, payment_intents,
      earnings, fraud_logs, failed_jobs, blockchain_cursors,
      onboarding_sessions
    RESTART IDENTITY CASCADE
  `);
  console.log('Database cleared (kept groups/admins)');

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const chatId = '-1003541260815';
  const userId = '672236709';
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/banChatMember`, {
    method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify({ chat_id: chatId, user_id: Number(userId) })
  }).then(r=>r.json()).then(d=>console.log('Banned:', d.ok));
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/unbanChatMember`, {
    method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify({ chat_id: chatId, user_id: Number(userId), only_if_banned: true })
  }).then(r=>r.json()).then(d=>console.log('Unbanned:', d.ok));

  const redis = new Redis(process.env.REDIS_URL);
  await redis.flushdb();
  console.log('Redis flushed');
  await redis.quit();
  await pool.end();
  console.log('Reset complete');
}

reset().catch(e => { console.error(e.message); process.exit(1); });
