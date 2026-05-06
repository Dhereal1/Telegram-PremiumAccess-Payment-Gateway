import crypto from 'crypto'
import IORedis from 'ioredis'
import { requireRedisUrl } from './env.js'

let redis

function getRedis() {
  if (redis) return redis
  redis = new IORedis(requireRedisUrl(), { maxRetriesPerRequest: null, enableReadyCheck: false })
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
