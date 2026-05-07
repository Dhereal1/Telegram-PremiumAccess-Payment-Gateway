import { Telegraf } from 'telegraf'
import { readJson } from '../../lib/http.js'
import crypto from 'crypto'
import { getLogger } from '../../lib/log.js'

const log = getLogger()
let bot
let botWebAppUrl

function getBot() {
  if (bot) return bot

  const botToken = process.env.BOT_TOKEN
  const webAppUrl = process.env.WEB_APP_URL
  if (!botToken) throw new Error('Missing BOT_TOKEN env var')
  if (!webAppUrl) throw new Error('Missing WEB_APP_URL env var (must be HTTPS and publicly reachable)')

  botWebAppUrl = webAppUrl
  bot = new Telegraf(botToken)

  bot.start(async (ctx) => {
    await ctx.reply('Welcome! Launch the app below:', {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🚀 Open App',
              web_app: { url: botWebAppUrl },
            },
          ],
        ],
      },
    })
  })

  bot.catch((err, ctx) => {
    const updateId = ctx?.update?.update_id
    log.error({ updateId, err: String(err?.message || err) }, 'bot_error')
  })

  return bot
}

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).send('OK')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (webhookSecret) {
      const header = req.headers['x-telegram-bot-api-secret-token']
      const provided = Array.isArray(header) ? header[0] : header
      const ok = timingSafeEqualUtf8(String(provided || ''), webhookSecret)
      if (!ok) return res.status(401).json({ error: 'Unauthorized' })
    }

    const update = req.body && typeof req.body === 'object' ? req.body : await readJson(req)
    await getBot().handleUpdate(update)
    return res.status(200).send('OK')
  } catch (e) {
    log.error({ err: String(e?.message || e) }, 'webhook_handler_failed')
    return res.status(500).json({ error: 'Webhook handler failed' })
  }
}

function timingSafeEqualUtf8(a, b) {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}
