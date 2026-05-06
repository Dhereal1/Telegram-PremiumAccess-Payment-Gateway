import { setCors, readJson } from '../_lib/http.js';
import { parseJson } from '../_lib/validation.js';
import { z } from 'zod';
import { getQueues } from '../_lib/queue.js';
import { getPool } from '../_lib/db.js';
import { getLogger } from '../_lib/log.js';

const BodySchema = z.object({
  queue: z.enum(['payment-verification', 'access-grant', 'notification']),
  jobId: z.string().min(1),
  data: z.any().optional(),
});

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'Missing CRON_SECRET' });
  const header = req.headers['x-cron-secret'];
  const provided = Array.isArray(header) ? header[0] : header;
  if (provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const body = await readJson(req);
  const { queue, jobId, data } = parseJson(body, BodySchema);

  const { paymentVerificationQueue, accessGrantQueue, notificationQueue } = getQueues();
  const map = {
    'payment-verification': paymentVerificationQueue,
    'access-grant': accessGrantQueue,
    notification: notificationQueue,
  };

  const log = getLogger();
  const pool = getPool();

  try {
    await pool.query(`INSERT INTO admin_actions (action, payload) VALUES ($1, $2)`, [
      'replay_job_attempt',
      JSON.stringify({ queue, jobId }),
    ]);

    const q = map[queue];
    await q.add('replay', data || {}, { jobId });

    await pool.query(`INSERT INTO admin_actions (action, payload) VALUES ($1, $2)`, [
      'replay_job_success',
      JSON.stringify({ queue, jobId }),
    ]);

    log.info({ queue, jobId }, 'admin_replay_job_success');
    return res.json({ ok: true });
  } catch (e) {
    await pool.query(`INSERT INTO admin_actions (action, payload) VALUES ($1, $2)`, [
      'replay_job_failure',
      JSON.stringify({ queue, jobId, error: String(e?.message || e) }),
    ]);
    log.error({ queue, jobId, err: String(e?.message || e) }, 'admin_replay_job_failed');
    return res.status(500).json({ error: 'Replay failed' });
  }
}
