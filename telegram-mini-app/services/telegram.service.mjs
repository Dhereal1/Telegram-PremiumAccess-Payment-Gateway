import fetch from 'node-fetch'

const BOT_TOKEN = process.env.BOT_TOKEN
const CHANNEL_ID = process.env.CHANNEL_ID

export async function createInviteLink({ chatId, memberLimit = 1, expireSeconds = 3600 } = {}) {
  if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN')
  const targetChatId = chatId ?? CHANNEL_ID
  if (!targetChatId) throw new Error('Missing chatId (or CHANNEL_ID)')

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/createChatInviteLink`
  const now = Math.floor(Date.now() / 1000)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: targetChatId,
      member_limit: memberLimit,
      expire_date: now + expireSeconds
    })
  })

  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.description || 'Failed to create invite link')
  return data.result.invite_link
}

export async function sendMessage(chatId, text) {
  if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN')

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    })
  })

  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.description || 'Failed to send message')
}
