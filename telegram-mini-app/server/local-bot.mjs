import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Telegraf } from 'telegraf'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

const token = process.env.BOT_TOKEN
const webAppUrl = process.env.WEB_APP_URL

if (!token) throw new Error('Missing BOT_TOKEN')
if (!webAppUrl || !/^https:\/\//i.test(webAppUrl)) throw new Error('Missing WEB_APP_URL (must be https://...)')

const bot = new Telegraf(token)

bot.start(async (ctx) => {
  await ctx.reply('Welcome! Launch the app below:', {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '🚀 Open App',
            web_app: { url: webAppUrl },
          },
        ],
      ],
    },
  })
})

bot.launch()

console.log('[local-bot] polling started')

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
