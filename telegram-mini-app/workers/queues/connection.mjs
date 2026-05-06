import IORedis from 'ioredis'

if (!process.env.REDIS_URL) {
  throw new Error('Missing REDIS_URL')
}

export const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
})
