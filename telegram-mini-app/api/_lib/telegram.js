import crypto from 'crypto';

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function verifyTelegramData(initData, botToken, { maxAgeSeconds } = {}) {
  if (!initData || typeof initData !== 'string') return { ok: false, reason: 'Missing initData' };
  if (!botToken) return { ok: false, reason: 'Missing bot token' };

  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  if (!hash) return { ok: false, reason: 'Missing hash' };

  const authDate = urlParams.get('auth_date');
  if (maxAgeSeconds && authDate) {
    const authDateSec = Number(authDate);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(authDateSec)) return { ok: false, reason: 'Invalid auth_date' };
    if (nowSec - authDateSec > maxAgeSeconds) return { ok: false, reason: 'initData expired' };
  }

  urlParams.delete('hash');

  const dataCheckString = Array.from(urlParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const ok = timingSafeEqualHex(hmac, hash);
  return ok ? { ok: true } : { ok: false, reason: 'Hash mismatch' };
}

export function parseTelegramUser(initData) {
  const urlParams = new URLSearchParams(initData);
  const rawUser = urlParams.get('user');
  if (!rawUser) return null;
  try {
    return JSON.parse(rawUser);
  } catch {
    return null;
  }
}
