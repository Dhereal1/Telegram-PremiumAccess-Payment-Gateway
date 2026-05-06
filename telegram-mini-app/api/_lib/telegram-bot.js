import fetch from 'node-fetch';

export async function createInviteLink({ botToken, channelId, memberLimit = 1, expireSeconds = 3600 }) {
  const url = `https://api.telegram.org/bot${botToken}/createChatInviteLink`;
  const now = Math.floor(Date.now() / 1000);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: channelId,
      member_limit: memberLimit,
      expire_date: now + expireSeconds,
      creates_join_request: false,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.description || `createChatInviteLink failed (${res.status})`);
  }
  return data.result.invite_link;
}

export async function sendAccessMessage({ botToken, telegramId, inviteLink }) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: telegramId,
      text: `✅ Payment confirmed!\n\n🎉 Join your premium access:\n${inviteLink}`,
      disable_web_page_preview: true,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.description || `sendMessage failed (${res.status})`);
  }
}

