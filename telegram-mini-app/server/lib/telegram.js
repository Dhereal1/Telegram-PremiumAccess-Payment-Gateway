import crypto from 'crypto'

export function verifyTelegramData(initData, botToken, { maxAgeSeconds = 300 } = {}) {
  if (!initData || typeof initData !== 'string') return { ok: false, reason: 'Missing initData' }
  if (!botToken || typeof botToken !== 'string') return { ok: false, reason: 'Missing BOT_TOKEN' }

  const urlParams = new URLSearchParams(initData)
  const hash = urlParams.get('hash')
  if (!hash) return { ok: false, reason: 'Missing hash' }
  urlParams.delete('hash')

  // Verify signature (official WebAppData method)
  const dataCheckString = Array.from(urlParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  if (hmac !== hash) return { ok: false, reason: 'Hash mismatch' }

  // Replay protection AFTER signature verification
  const authDate = Number(urlParams.get('auth_date') || '0')
  if (!authDate) return { ok: false, reason: 'Missing auth_date' }
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate
  if (ageSeconds > maxAgeSeconds) return { ok: false, reason: 'initData too old' }
  if (ageSeconds < -60) return { ok: false, reason: 'auth_date in future' }

  return { ok: true }
}

export function parseTelegramUser(initData) {
  if (!initData || typeof initData !== 'string') return null
  const urlParams = new URLSearchParams(initData)
  const userStr = urlParams.get('user')
  if (!userStr) return null
  try {
    return JSON.parse(userStr)
  } catch {
    return null
  }
}

