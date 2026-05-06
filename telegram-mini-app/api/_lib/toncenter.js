import axios from 'axios';
import { Address, Cell, Slice, toNano } from '@ton/core';

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

  // If body is provided as raw BOC, decode comment payload (opcode=0 + string tail)
  // Common shape: { "@type": "msg.dataRaw", "body": "<base64>", "init_state": "<base64>" }
  if (msgData['@type'] === 'msg.dataRaw' && typeof msgData.body === 'string' && msgData.body) {
    const comment = tryDecodeCommentFromBocBase64(msgData.body);
    if (comment) return comment;
  }

  return null;
}

function tryDecodeCommentFromBocBase64(bodyBase64) {
  try {
    // TON Center returns standard base64; BOC is binary
    const buf = Buffer.from(bodyBase64, 'base64');
    const cells = Cell.fromBoc(buf);
    const cell = cells[0];
    if (!cell) return null;

    let slice = cell.beginParse();
    // op is 32-bit unsigned, 0 indicates comment
    if (slice.remainingBits < 32) return null;
    const op = slice.loadUint(32);
    if (op !== 0) return null;

    const text = loadStringTailSafe(slice);
    return text?.trim() || null;
  } catch {
    return null;
  }
}

function loadStringTailSafe(slice) {
  // @ton/core Slice supports loadStringTail() in most versions; provide fallback.
  if (typeof slice.loadStringTail === 'function') return slice.loadStringTail();

  // Fallback: read remaining bits as bytes and decode utf8 (best-effort).
  const remainingBytes = Math.floor(slice.remainingBits / 8);
  const bytes = slice.loadBuffer(remainingBytes);
  return bytes.toString('utf8');
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
