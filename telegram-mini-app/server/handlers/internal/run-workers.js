import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import crypto from 'crypto'
import { setCors } from '../../lib/http.js'
import { getDb } from '../../../workers/_lib/db.mjs'
import { getWorkerLogger } from '../../../workers/_lib/logger.mjs'
import { getTransactions, getTxCursor } from '../../lib/toncenter.js'
import { processVerifyPaymentCore } from '../../../workers/processors/verifyPaymentWorker.mjs'
import { processAccessGrantJob } from '../../../workers/processors/grantAccessWorker.mjs'
import { processExpiryJob } from '../../../workers/processors/expiryWorker.mjs'

const log = getWorkerLogger()
const pool = getDb()

function isAuthorizedCron(req) {
  const secret = process.env.CRON_SECRET
  const cronHeader = req.headers['x-vercel-cron']
  const isVercelCron = Array.isArray(cronHeader) ? cronHeader[0] === '1' : cronHeader === '1'
  if (isVercelCron) return true
  if (!secret) return { ok: false, status: 500, error: 'Missing CRON_SECRET' }
  const header = req.headers['x-cron-secret']
  const provided = Array.isArray(header) ? header[0] : header
  if (provided !== secret) return { ok: false, status: 401, error: 'Unauthorized' }
  return true
}

async function getCursor({ id }) {
  const row = await pool.query('SELECT last_lt, last_hash FROM blockchain_cursors WHERE id=$1', [id])
  const cur = row.rows[0] || {}
  return { lastLt: cur.last_lt ? String(cur.last_lt) : null, lastHash: cur.last_hash || null }
}

async function saveCursor({ id, lt, hash }) {
  if (!lt || !hash) return
  await pool.query(
    `INSERT INTO blockchain_cursors (id, last_lt, last_hash, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET last_lt=EXCLUDED.last_lt, last_hash=EXCLUDED.last_hash, updated_at=NOW()`,
    [id, String(lt), String(hash)],
  )
}

async function tonPollAndEnqueue({ paymentVerificationQueue, receiverAddress, apiUrl, apiKey, maxEnqueue }) {
  const id = `ton:${receiverAddress}`
  const { lastLt, lastHash } = await getCursor({ id })

  const pageLimit = Number(process.env.TON_TX_PAGE_LIMIT || '50')
  const maxPages = Number(process.env.TON_TX_MAX_PAGES || '4')

  const collected = []
  let pageLt = null
  let pageHash = null

  for (let page = 0; page < maxPages; page++) {
    const pageTxs = await getTransactions({
      apiUrl,
      apiKey,
      address: receiverAddress,
      limit: pageLimit,
      ...(pageLt && pageHash ? { lt: pageLt, hash: pageHash } : {}),
    })
    if (!Array.isArray(pageTxs) || pageTxs.length === 0) break

    let slice = pageTxs
    if (lastLt && lastHash) {
      const idx = pageTxs.findIndex((t) => t?.transaction_id?.lt === lastLt && t?.transaction_id?.hash === lastHash)
      if (idx >= 0) {
        slice = pageTxs.slice(0, idx)
        collected.push(...slice)
        break
      }
    }

    collected.push(...slice)

    const lastTx = pageTxs[pageTxs.length - 1]
    const cursor = getTxCursor(lastTx)
    if (!cursor) break
    pageLt = cursor.lt
    pageHash = cursor.hash

    if (pageTxs.length < pageLimit) break
  }

  const txs = collected.slice().reverse()
  let enqueued = 0

  for (const tx of txs) {
    if (enqueued >= maxEnqueue) break
    const txHash = tx?.transaction_id?.hash || tx?.in_msg?.hash || tx?.hash
    if (!txHash) continue

    try {
      await paymentVerificationQueue.add('verify-payment', { tx }, { jobId: `tx:${String(txHash)}` })
    } catch {
      // ignore duplicate jobId
    }

    enqueued++

    // Cursor advances only after enqueue succeeds (no gaps on restart).
    const cur = getTxCursor(tx)
    if (cur) await saveCursor({ id, ...cur })
  }

  return { scanned: collected.length, enqueued }
}

async function enqueueExpiryTick({ expiryQueue }) {
  const jobId = `expiry:${Math.floor(Date.now() / 60000)}`
  try {
    await expiryQueue.add('expire', { limit: 200 }, { jobId })
    return { enqueued: true, jobId }
  } catch {
    return { enqueued: false, jobId }
  }
}

async function runQueueBatch({ queueName, connection, processor, maxJobs, maxMs }) {
  let done = 0
  let closed = false

  return await new Promise((resolve, reject) => {
    const worker = new Worker(queueName, async (job) => processor(job), { connection, concurrency: 1 })

    const finish = async () => {
      if (closed) return
      closed = true
      try {
        await worker.close()
      } catch {
        // ignore
      }
      resolve({ processed: done })
    }

    const timeout = setTimeout(() => {
      finish().catch(() => {})
    }, maxMs)

    const bump = async (job, err) => {
      done++
      if (err) {
        log.error({ jobId: job?.id, queue: queueName, err: String(err?.message || err) }, 'run_workers_job_failed')
      }
      if (done >= maxJobs) {
        clearTimeout(timeout)
        await finish()
      }
    }

    worker.on('completed', (job) => bump(job).catch(reject))
    worker.on('failed', (job, err) => bump(job, err).catch(reject))
    worker.on('drained', () => {
      clearTimeout(timeout)
      finish().catch(reject)
    })
    worker.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = isAuthorizedCron(req)
  if (auth !== true) return res.status(auth.status).json({ error: auth.error })

  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) return res.status(500).json({ error: 'Missing REDIS_URL' })
  if (!process.env.DATABASE_URL) return res.status(500).json({ error: 'Missing DATABASE_URL' })

  const receiverAddress = process.env.TON_RECEIVER_ADDRESS
  const tonApiUrl = process.env.TON_API_URL || 'https://toncenter.com/api/v2'
  if (!receiverAddress) return res.status(500).json({ error: 'Missing TON_RECEIVER_ADDRESS' })

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false })
  const runId = crypto.randomUUID()
  const lockKey = 'run-workers:lock'
  const lockTtlMs = Number(process.env.RUN_WORKERS_LOCK_TTL_MS || '55000')

  const gotLock = await connection.set(lockKey, runId, 'PX', lockTtlMs, 'NX')
  if (gotLock !== 'OK') {
    try {
      await connection.quit()
    } catch {
      // ignore
    }
    return res.status(202).json({ ok: true, skipped: true, reason: 'run-workers already running' })
  }

  const paymentVerificationQueue = new Queue('payment-verification', { connection })
  const accessGrantQueue = new Queue('access-grant', { connection })
  const expiryQueue = new Queue('expiry', { connection })

  const maxMs = Number(process.env.RUN_WORKERS_MAX_MS || '25000')
  const maxVerify = Number(process.env.RUN_WORKERS_MAX_VERIFY || '15')
  const maxAccess = Number(process.env.RUN_WORKERS_MAX_ACCESS || '10')
  const maxExpiry = Number(process.env.RUN_WORKERS_MAX_EXPIRY || '2')
  const maxTonEnqueue = Number(process.env.RUN_WORKERS_MAX_TON_ENQUEUE || '25')

  const startedAt = Date.now()

  try {
    const ton = await tonPollAndEnqueue({
      paymentVerificationQueue,
      receiverAddress,
      apiUrl: tonApiUrl,
      apiKey: process.env.TON_API_KEY,
      maxEnqueue: maxTonEnqueue,
    })

    const expiryTick = await enqueueExpiryTick({ expiryQueue })

    const verifyRes = await runQueueBatch({
      queueName: 'payment-verification',
      connection,
      maxJobs: maxVerify,
      maxMs,
      processor: async (job) => {
        const out = await processVerifyPaymentCore(job)
        if (out?.enqueueAccess) {
          await accessGrantQueue.add(
            'grant-access',
            { userId: out.enqueueAccessUserId, telegramId: out.enqueueAccessTelegramId },
            { jobId: `access:${out.enqueueAccessUserId}` },
          )
        }
        return out
      },
    })

    const accessRes = await runQueueBatch({
      queueName: 'access-grant',
      connection,
      maxJobs: maxAccess,
      maxMs,
      processor: processAccessGrantJob,
    })

    const expiryRes = await runQueueBatch({
      queueName: 'expiry',
      connection,
      maxJobs: maxExpiry,
      maxMs,
      processor: processExpiryJob,
    })

    const elapsedMs = Date.now() - startedAt
    log.info(
      {
        queue: 'internal',
        jobId: `run-workers:${new Date().toISOString()}`,
        ton,
        expiryTick,
        verify: verifyRes,
        access: accessRes,
        expiry: expiryRes,
        elapsedMs,
      },
      'run_workers_done',
    )

    return res.json({ ok: true, ton, expiryTick, verify: verifyRes, access: accessRes, expiry: expiryRes, elapsedMs })
  } catch (e) {
    log.error({ err: String(e?.message || e) }, 'run_workers_failed')
    return res.status(500).json({ ok: false, error: String(e?.message || e) })
  } finally {
    try {
      await paymentVerificationQueue.close()
      await accessGrantQueue.close()
      await expiryQueue.close()
    } catch {
      // ignore
    }
    try {
      const cur = await connection.get(lockKey)
      if (cur === runId) await connection.del(lockKey)
      await connection.quit()
    } catch {
      // ignore
    }
  }
}

