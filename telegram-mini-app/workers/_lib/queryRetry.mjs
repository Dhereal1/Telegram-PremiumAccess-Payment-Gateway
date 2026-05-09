function isRetryableDbError(err) {
  const msg = String(err?.message || err || '')
  return (
    msg.includes('Connection terminated') ||
    msg.includes('connection timeout') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('EAI_AGAIN')
  )
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

export async function queryWithRetry(pool, text, params = [], opts = {}) {
  const attempts = Number(opts.attempts ?? 3)
  const baseDelayMs = Number(opts.baseDelayMs ?? 250)

  let lastErr
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await pool.query(text, params)
    } catch (err) {
      lastErr = err
      if (!isRetryableDbError(err) || attempt === attempts) throw err
      const delay = Math.min(5000, baseDelayMs * 2 ** (attempt - 1))
      await sleep(delay)
    }
  }
  throw lastErr
}

