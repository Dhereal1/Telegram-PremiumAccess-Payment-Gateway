import axios from 'axios';
import { Address, toNano } from '@ton/core';

export function normalizeTonAddress(address) {
  if (!address || typeof address !== 'string') return null;
  try {
    return Address.parse(address).toRawString();
  } catch {
    return null;
  }
}

export function parseCommentFromTx(tx) {
  const msg = tx?.in_msg;
  if (!msg) return null;

  // TON Center may already provide decoded message text
  if (typeof msg.message === 'string' && msg.message.trim()) return msg.message.trim();

  const msgData = msg.msg_data;
  if (!msgData) return null;

  if (msgData['@type'] === 'msg.dataText' && typeof msgData.text === 'string') {
    return msgData.text.trim();
  }

  return null;
}

export function extractTelegramIdFromComment(comment) {
  if (!comment) return null;
  const m = String(comment).match(/(?:^|\\s)tp:(\\d+)(?:\\||\\s|$)/);
  return m ? m[1] : null;
}

export function isValidIncomingPayment(tx, { receiverAddress, minTon }) {
  const msg = tx?.in_msg;
  if (!msg) return { ok: false, reason: 'Missing in_msg' };

  const dstRaw = normalizeTonAddress(msg.destination);
  const receiverRaw = normalizeTonAddress(receiverAddress);
  if (!dstRaw || !receiverRaw) return { ok: false, reason: 'Bad address format' };
  if (dstRaw !== receiverRaw) return { ok: false, reason: 'Wrong recipient' };

  try {
    const value = BigInt(msg.value || '0');
    const min = BigInt(toNano(minTon).toString());
    if (value < min) return { ok: false, reason: 'Amount too low' };
  } catch {
    return { ok: false, reason: 'Bad amount' };
  }

  return { ok: true };
}

export async function getTransactions({ apiUrl, apiKey, address, limit = 20 }) {
  const url = `${apiUrl.replace(/\\/$/, '')}/getTransactions`;
  const res = await axios.get(url, {
    params: { address, limit },
    headers: apiKey ? { 'X-API-Key': apiKey } : undefined,
    timeout: 15000,
  });

  return res.data?.result || [];
}

