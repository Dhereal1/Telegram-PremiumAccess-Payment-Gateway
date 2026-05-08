import crypto from 'crypto'
import dns from 'dns'
import IORedis from 'ioredis'
import { requireRedisUrl } from './env.js'
import { getLogger } from './log.js'

let redis
const log = getLogger()

// Prefer IPv4 to reduce transient DNS failures to hosted Redis on some networks.
try {
  dns.setDefaultResultOrder('ipv4first')
} catch {
  // ignore
}

function getRedis() {
  if (redis) return redis
  // Rate limiting must fail fast in serverless; do not hang requests if Redis is unavailable.
  redis = new IORedis(requireRedisUrl(), {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    family: 4,
    connectTimeout: 2000,
    commandTimeout: 2000,
    retryStrategy: () => null,
  })
  // Prevent unhandled 'error' events from crashing the process (common on serverless cold starts / idle closes).
  redis.on('error', (err) => {
    log.error({ err: String(err?.message || err) }, 'redis_error')
  })
  return redis
}

export async function rateLimit({ key, limit, windowSeconds }) {
  const r = getRedis()
  const now = Math.floor(Date.now() / 1000)
  const windowKey = `rl:${key}:${Math.floor(now / windowSeconds)}`

  const multi = r.multi()
  multi.incr(windowKey)
  multi.expire(windowKey, windowSeconds)
  const [[, count]] = await multi.exec()

  const remaining = Math.max(0, limit - Number(count))
  return { ok: Number(count) <= limit, remaining }
}

export function ipKey(req) {
  const xf = req.headers['x-forwarded-for']
  const ip = (Array.isArray(xf) ? xf[0] : xf) || req.socket?.remoteAddress || 'unknown'
  return crypto.createHash('sha256').update(String(ip)).digest('hex')
}
