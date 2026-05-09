export function setCors(res) {
  const origin = String(process.env.WEB_APP_URL || '').trim().replace(/\/+$/, '')
  // In multi-tenant production, only allow the deployed Mini App origin.
  // Fallback to '*' only when WEB_APP_URL is not configured (local/dev).
  res.setHeader('Access-Control-Allow-Origin', origin || '*')
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
  // Require shared secret. Do not trust `x-vercel-cron` alone (spoofable by any client).
  const secret = process.env.CRON_SECRET
  if (!secret) return { ok: false }

  const header = req.headers['x-cron-secret']
  const provided = Array.isArray(header) ? header[0] : header
  if (typeof provided !== 'string' || provided !== secret) return { ok: false }
  return { ok: true, mode: 'secret-header' }
}
