import adminReplayJob from '../server/handlers/admin/replay-job.js'
import adminHealth from '../server/handlers/admin/health.js'
import authTelegram from '../server/handlers/auth/telegram.js'
import cronGrantAccess from '../server/handlers/cron/grant-access.js'
import cronVerifyPayments from '../server/handlers/cron/verify-payments.js'
import internalRetryFailed from '../server/handlers/internal/retry-failed.js'
import internalRunWorkers from '../server/handlers/internal/run-workers.js'
import paymentIntentsCreate from '../server/handlers/payment-intents/create.js'
import paymentsSubmitTx from '../server/handlers/payments/submit-tx.js'
import telegramWebhook from '../server/handlers/telegram/webhook.js'
import tonconnectManifest from '../server/handlers/tonconnect/manifest.js'
import userRegenerateInvite from '../server/handlers/user/regenerate-invite.js'
import userWallet from '../server/handlers/user/wallet.js'
import userStatusTelegramId from '../server/handlers/user/status/[telegram_id].js'

function getPath(req) {
  // When using Vercel rewrites, we preserve the original API path in `__path`.
  // Example: /api/user/status/123 -> /api/index?__path=/user/status/123
  const u = new URL(req.url, 'http://localhost')
  const override = u.searchParams.get('__path')
  if (override) return override.startsWith('/') ? override : `/${override}`

  const pathname = u.pathname || '/'
  if (!pathname.startsWith('/api')) return pathname
  const stripped = pathname.slice('/api'.length) || '/'
  return stripped.startsWith('/') ? stripped : `/${stripped}`
}

function ensureQueryParam(req, key, value) {
  if (!req.query || typeof req.query !== 'object') req.query = {}
  if (req.query[key] == null) req.query[key] = value
}

export default async function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase()
  const path = getPath(req)

  try {
    // Dynamic route: /user/status/:telegram_id
    if (method === 'GET') {
      const m = path.match(/^\/user\/status\/([^/]+)$/)
      if (m) {
        ensureQueryParam(req, 'telegram_id', decodeURIComponent(m[1]))
        return userStatusTelegramId(req, res)
      }
    }

    const key = `${method} ${path}`
    switch (key) {
      case 'GET /telegram/webhook':
      case 'POST /telegram/webhook':
        return telegramWebhook(req, res)

      case 'POST /auth/telegram':
        return authTelegram(req, res)

      case 'POST /user/wallet':
        return userWallet(req, res)

      case 'POST /user/regenerate-invite':
        return userRegenerateInvite(req, res)

      case 'POST /payment-intents/create':
        return paymentIntentsCreate(req, res)

      case 'POST /payments/submit-tx':
        return paymentsSubmitTx(req, res)

      case 'POST /internal/run-workers':
      case 'GET /internal/run-workers':
        return internalRunWorkers(req, res)

      case 'POST /internal/retry-failed':
      case 'GET /internal/retry-failed':
        return internalRetryFailed(req, res)

      case 'POST /admin/replay-job':
        return adminReplayJob(req, res)

      case 'GET /admin/health':
        return adminHealth(req, res)

      case 'GET /tonconnect/manifest':
      case 'OPTIONS /tonconnect/manifest':
        return tonconnectManifest(req, res)

      // Legacy cron endpoints (kept for compatibility; typically return 410 unless ENABLE_LEGACY_CRON=1)
      case 'GET /cron/verify-payments':
      case 'POST /cron/verify-payments':
        return cronVerifyPayments(req, res)
      case 'GET /cron/grant-access':
      case 'POST /cron/grant-access':
        return cronGrantAccess(req, res)

      default:
        return res.status(404).json({ error: 'Not found', method, path })
    }
  } catch (e) {
    return res.status(500).json({ error: 'Internal error', message: String(e?.message || e) })
  }
}
