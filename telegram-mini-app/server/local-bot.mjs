import dotenv from 'dotenv'
import path from 'node:path'
import dns from 'node:dns'
import { fileURLToPath } from 'node:url'
import { createBot } from './bot.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Windows/ISP DNS can intermittently fail AAAA lookups; prefer IPv4 first to reduce EAI_AGAIN in local dev.
dns.setDefaultResultOrder('ipv4first')

dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

// Optional override to use known-stable resolvers on flaky networks.
// Example: DNS_SERVERS=1.1.1.1,8.8.8.8
if (process.env.DNS_SERVERS) {
  const servers = String(process.env.DNS_SERVERS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (servers.length) dns.setServers(servers)
}

const token = process.env.BOT_TOKEN
const webAppUrl = process.env.WEB_APP_URL
const updateMode = String(process.env.TELEGRAM_UPDATE_MODE || 'polling').trim().toLowerCase()

if (!token) throw new Error('Missing BOT_TOKEN')
if (!webAppUrl || !/^https:\/\//i.test(webAppUrl)) throw new Error('Missing WEB_APP_URL (must be https://...)')

if (updateMode === 'webhook') {
  console.log('[local-bot] TELEGRAM_UPDATE_MODE=webhook; bot will be handled by /api/telegram/webhook in local-web')
  // Keep the process alive so `pm2 resurrect` brings up a consistent set of processes,
  // but do not start polling (webhook + polling conflict with 409 errors).
  while (true) {
    await sleep(60_000)
  }
}

const bot = createBot({ botToken: token, webAppUrl })

bot.catch((err, ctx) => {
  // Keep the bot alive on handler errors.
  console.error('[local-bot] unhandled bot error', { err: String(err?.message || err), updateType: ctx?.updateType })
})

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

async function launchWithRetry() {
  let attempt = 0
  // Telegraf performs network calls (e.g. getMe). On flaky DNS, retry instead of crashing.
  // Warm botInfo first; Telegraf will skip its own getMe call if bot.botInfo is present.
  while (true) {
    attempt += 1
    try {
      if (!bot.botInfo) {
        bot.botInfo = await bot.telegram.getMe()
      }
      // Polling requires webhook to be disabled; if a previous run enabled it, remove it.
      await bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {})
      // Telegram can briefly return 409 while webhook state is settling; small delay helps stabilize.
      await sleep(500)
      await bot.launch()
      return
    } catch (e) {
      const msg = String(e?.message || e)
      console.error('[local-bot] launch failed, retrying', { attempt, err: msg })
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(5, attempt - 1))
      await sleep(delay)
    }
  }
}

await launchWithRetry()

console.log('[local-bot] polling started')

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
