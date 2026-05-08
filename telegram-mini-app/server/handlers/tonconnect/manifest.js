export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const envBase = String(process.env.WEB_APP_URL || '').trim().replace(/\/+$/, '')
  const hasEnvBase = /^https:\/\//i.test(envBase)

  const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0].trim()
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0].trim()
  const headerOrigin = host ? `${proto}://${host}` : ''

  const origin = hasEnvBase ? envBase : headerOrigin

  return res.json({
    url: origin,
    name: 'TON Premium App',
    iconUrl: `${origin}/icon.png`,
  })
}
