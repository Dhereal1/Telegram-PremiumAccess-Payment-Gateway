import { Worker } from 'bullmq';
import { getRedis } from './_lib/redis.mjs';
import { getDb } from './_lib/db.mjs';
import { getWorkerEnv } from './_lib/worker-env.mjs';
import { getWorkerLogger } from './_lib/logger.mjs';
import { createInviteLink, sendAccessMessage } from '../api/_lib/telegram-bot.js';

const env = getWorkerEnv();
const log = getWorkerLogger();
const connection = getRedis();
const pool = getDb();

async function processJob(job) {
  const telegramId = job.data?.telegramId;
  if (!telegramId) return { ok: false, reason: 'Missing telegramId' };
  if (!env.CHANNEL_ID) return { ok: false, reason: 'Missing CHANNEL_ID' };

  const user = await pool.query('SELECT payment_status, access_granted, expiry_date FROM users WHERE telegram_id=$1', [
    String(telegramId),
  ]);
  if (!user.rows.length) return { ok: false, reason: 'User not found' };

  const row = user.rows[0];
  if (!row.payment_status) return { ok: true, status: 'not_paid' };
  if (row.expiry_date && new Date(row.expiry_date).getTime() < Date.now()) return { ok: true, status: 'expired' };
  if (row.access_granted === true) return { ok: true, status: 'already_granted' };

  const inviteLink = await createInviteLink({
    botToken: env.BOT_TOKEN,
    channelId: env.CHANNEL_ID,
    memberLimit: 1,
    expireSeconds: 3600,
  });

  await sendAccessMessage({ botToken: env.BOT_TOKEN, telegramId: String(telegramId), inviteLink });
  await pool.query('UPDATE users SET access_granted=true WHERE telegram_id=$1', [String(telegramId)]);

  return { ok: true, status: 'granted' };
}

const worker = new Worker(
  'access_grant_queue',
  async (job) => {
    const res = await processJob(job);
    log.info({ jobId: job.id, telegramId: job.data?.telegramId, ...res }, 'grant_access_done');
    return res;
  },
  { connection, concurrency: Number(process.env.GRANT_WORKER_CONCURRENCY || '4') },
);

worker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err: String(err?.message || err) }, 'grant_access_failed');
});

log.info('grantAccessWorker started');

