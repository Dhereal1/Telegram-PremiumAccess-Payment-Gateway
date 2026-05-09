import 'dotenv/config'

const token = process.env.BOT_TOKEN
if (!token) {
  console.error('Missing BOT_TOKEN in environment/.env')
  process.exit(1)
}

const base = String(process.env.WEB_APP_URL || '').trim().replace(/\/+$/, '')
if (!base || !/^https:\/\//i.test(base)) {
  console.error('Missing/invalid WEB_APP_URL (must be https://...)')
  process.exit(1)
}

const webhookUrl = `${base}/api/telegram/webhook`
const payload = { url: webhookUrl }
if (process.env.TELEGRAM_WEBHOOK_SECRET) payload.secret_token = process.env.TELEGRAM_WEBHOOK_SECRET

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
})

const text = await res.text()
if (!res.ok) {
  console.error(`setWebhook failed: ${text}`)
  process.exit(1)
}

console.log(`setWebhook ok: ${webhookUrl}`)

