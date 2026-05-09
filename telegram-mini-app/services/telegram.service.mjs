import fetch from 'node-fetch'

const BOT_TOKEN = process.env.BOT_TOKEN

export async function createInviteLink({ chatId, memberLimit = 1, expireSeconds = 3600 } = {}) {
  if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN')
  if (!chatId) throw new Error('Missing chatId')

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/createChatInviteLink`
  const now = Math.floor(Date.now() / 1000)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      member_limit: memberLimit,
      expire_date: now + expireSeconds
    })
  })

  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.description || 'Failed to create invite link')
  return data.result.invite_link
}

export async function sendMessage(chatId, text, opts = {}) {
  if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN')

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true
      ,
      ...(opts?.reply_markup ? { reply_markup: opts.reply_markup } : {})
    })
  })

  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.description || 'Failed to send message')
}

// Best-effort removal from a group/channel (requires bot admin permissions).
// Implemented as "ban then unban" to mimic kick behavior.
export async function kickChatMember({ chatId, userId }) {
  if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN')
  if (!chatId) throw new Error('Missing chatId')
  if (!userId) throw new Error('Missing userId')

  const banUrl = `https://api.telegram.org/bot${BOT_TOKEN}/banChatMember`
  const unbanUrl = `https://api.telegram.org/bot${BOT_TOKEN}/unbanChatMember`
  const now = Math.floor(Date.now() / 1000)

  const banRes = await fetch(banUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      user_id: Number(userId),
      until_date: now + 60,
      revoke_messages: false,
    }),
  })
  const banData = await banRes.json().catch(() => null)
  if (!banRes.ok || !banData?.ok) throw new Error(banData?.description || 'Failed to banChatMember')

  const unbanRes = await fetch(unbanUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      user_id: Number(userId),
      only_if_banned: true,
    }),
  })
  const unbanData = await unbanRes.json().catch(() => null)
  if (!unbanRes.ok || !unbanData?.ok) throw new Error(unbanData?.description || 'Failed to unbanChatMember')
}
