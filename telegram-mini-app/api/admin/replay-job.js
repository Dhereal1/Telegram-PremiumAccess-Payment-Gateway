import { setCors, readJson } from '../_lib/http.js';
import { parseJson } from '../_lib/validation.js';
import { z } from 'zod';
import { getQueues } from '../_lib/queue.js';

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

  const q = map[queue];
  await q.add('replay', data || {}, { jobId });
  return res.json({ ok: true });
}

