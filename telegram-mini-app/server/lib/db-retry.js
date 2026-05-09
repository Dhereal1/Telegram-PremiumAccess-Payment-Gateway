function isTransientDbError(err) {
  const code = String(err?.code || err?.cause?.code || '')
  const msg = String(err?.message || err?.cause?.message || '')

  if (code === 'EAI_AGAIN' || code === 'ENOTFOUND' || code === 'ECONNRESET' || code === 'ETIMEDOUT') return true

  // pg pool / neon transient failures
  if (msg.includes('Connection terminated due to connection timeout')) return true
  if (msg.includes('Connection terminated unexpectedly')) return true
  if (msg.includes('timeout')) return true

  return false
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function queryWithRetry(pool, sql, params, { attempts = 3 } = {}) {
  let lastErr
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await pool.query(sql, params)
    } catch (e) {
      lastErr = e
      const transient = isTransientDbError(e)
      if (!transient || i === attempts - 1) throw e
      await sleep(200 * (i + 1))
    }
  }
  throw lastErr
}

