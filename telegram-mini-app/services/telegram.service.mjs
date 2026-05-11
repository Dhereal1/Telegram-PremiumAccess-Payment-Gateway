import fetch from 'node-fetch'

function fetchWithTimeout(url, { timeoutMs, ...opts } = {}) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs || 3000)
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(t))
}

export async function createInviteLink({ chatId, memberLimit = 1, expireSeconds = 3600 } = {}) {
  const BOT_TOKEN = process.env.BOT_TOKEN
  if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN')
  if (!chatId) throw new Error('Missing chatId')

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/createChatInviteLink`
  const now = Math.floor(Date.now() / 1000)

  const res = await fetchWithTimeout(url, {
    timeoutMs: 3000,
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

export async function revokeInviteLink({ chatId, inviteLink } = {}) {
  const BOT_TOKEN = process.env.BOT_TOKEN
  if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN')
  if (!chatId || !inviteLink) return

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/revokeChatInviteLink`
  const res = await fetchWithTimeout(url, {
    timeoutMs: 3000,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, invite_link: inviteLink }),
  })

  const data = await res.json().catch(() => null)
  return data
}

export async function getChat({ chatId } = {}) {
  const BOT_TOKEN = process.env.BOT_TOKEN
  if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN')
  if (!chatId) throw new Error('Missing chatId')

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChat`
  const res = await fetchWithTimeout(url, {
    timeoutMs: 3000,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.description || 'Failed to getChat')
  return data.result
}

export async function sendMessage(chatId, text, opts = {}) {
  const BOT_TOKEN = process.env.BOT_TOKEN
  if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN')
  if (!chatId) throw new Error('Missing chatId')
  if (typeof text !== 'string' || !text.trim()) throw new Error('Missing text')

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
  const res = await fetchWithTimeout(url, {
    timeoutMs: 3000,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(opts?.reply_markup ? { reply_markup: opts.reply_markup } : {})
    })
  })

  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.description || 'Failed to send message')
}

// Best-effort removal from a group/channel (requires bot admin permissions).
// Implemented as "ban then unban" to mimic kick behavior.
export async function kickChatMember({ chatId, userId }) {
  const BOT_TOKEN = process.env.BOT_TOKEN
  if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN')
  if (!chatId) throw new Error('Missing chatId')
  if (!userId) throw new Error('Missing userId')

  const banUrl = `https://api.telegram.org/bot${BOT_TOKEN}/banChatMember`
  const unbanUrl = `https://api.telegram.org/bot${BOT_TOKEN}/unbanChatMember`
  const now = Math.floor(Date.now() / 1000)

  const banRes = await fetchWithTimeout(banUrl, {
    timeoutMs: 3000,
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

  const unbanRes = await fetchWithTimeout(unbanUrl, {
    timeoutMs: 3000,
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


