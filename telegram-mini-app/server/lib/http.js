export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-telegram-init-data')
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body // Vercel may preparse
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return null
  return JSON.parse(raw)
}

export function requireCronAuth(req) {
  // Allow Vercel Cron invocations without additional secrets.
  // Vercel sets `x-vercel-cron: 1` on cron-triggered requests.
  const cronHeader = req.headers['x-vercel-cron']
  const isVercelCron = Array.isArray(cronHeader) ? cronHeader[0] === '1' : cronHeader === '1'
  if (isVercelCron) return { ok: true, mode: 'vercel-cron' }

  // Optional shared secret for manual triggering.
  const secret = process.env.CRON_SECRET
  if (!secret) return { ok: false }

  const header = req.headers['x-cron-secret']
  const provided = Array.isArray(header) ? header[0] : header
  if (typeof provided !== 'string' || provided !== secret) return { ok: false }
  return { ok: true, mode: 'secret-header' }
}
