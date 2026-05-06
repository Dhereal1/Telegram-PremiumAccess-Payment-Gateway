import { getDb } from '../_lib/db.mjs';
import { getWorkerEnv } from '../_lib/worker-env.mjs';
import { getWorkerLogger } from '../_lib/logger.mjs';
import { getTransactions, getTxCursor } from '../api/_lib/toncenter.js';
import { enqueuePaymentVerification } from '../producers/enqueuePaymentVerification.mjs';

const env = getWorkerEnv();
const log = getWorkerLogger();
const pool = getDb();

async function getCheckpoint() {
  const prefix = `ton:${env.TON_RECEIVER_ADDRESS}:`;
  const lastLtRow = await pool.query('SELECT value FROM verifier_state WHERE key = $1', [`${prefix}last_lt`]);
  const lastHashRow = await pool.query('SELECT value FROM verifier_state WHERE key = $1', [`${prefix}last_hash`]);
  return {
    prefix,
    lastLt: lastLtRow.rows[0]?.value || null,
    lastHash: lastHashRow.rows[0]?.value || null,
  };
}

async function setCheckpoint(prefix, cur) {
  if (!cur?.lt || !cur?.hash) return;
  await pool.query(
    `INSERT INTO verifier_state (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [`${prefix}last_lt`, String(cur.lt)],
  );
  await pool.query(
    `INSERT INTO verifier_state (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [`${prefix}last_hash`, String(cur.hash)],
  );
}

async function pollOnce() {
  const { prefix, lastLt, lastHash } = await getCheckpoint();
  const pageLimit = Number(process.env.TON_TX_PAGE_LIMIT || '50');
  const maxPages = Number(process.env.TON_TX_MAX_PAGES || '8');

  const collected = [];
  let pageLt = null;
  let pageHash = null;

  for (let page = 0; page < maxPages; page++) {
    const pageTxs = await getTransactions({
      apiUrl: env.TON_API_URL,
      apiKey: env.TON_API_KEY,
      address: env.TON_RECEIVER_ADDRESS,
      limit: pageLimit,
      ...(pageLt && pageHash ? { lt: pageLt, hash: pageHash } : {}),
    });
    if (!Array.isArray(pageTxs) || pageTxs.length === 0) break;

    let slice = pageTxs;
    if (lastLt && lastHash) {
      const idx = pageTxs.findIndex((t) => t?.transaction_id?.lt === lastLt && t?.transaction_id?.hash === lastHash);
      if (idx >= 0) {
        slice = pageTxs.slice(0, idx);
        collected.push(...slice);
        break;
      }
    }

    collected.push(...slice);

    const lastTx = pageTxs[pageTxs.length - 1];
    const cursor = getTxCursor(lastTx);
    if (!cursor) break;
    pageLt = cursor.lt;
    pageHash = cursor.hash;

    if (pageTxs.length < pageLimit) break;
  }

  const newestSeen = collected.length ? getTxCursor(collected[0]) : null;
  const txs = collected.slice().reverse();

  let enqueued = 0;
  for (const tx of txs) {
    const txHash = tx?.transaction_id?.hash || tx?.in_msg?.hash || tx?.hash;
    if (!txHash) continue;

    await enqueuePaymentVerification({ tx });
    enqueued++;
  }

  if (newestSeen) await setCheckpoint(prefix, newestSeen);
  return { enqueued, newestSeen, scanned: collected.length };
}

async function main() {
  const intervalMs = Number(process.env.TON_LISTENER_INTERVAL_MS || '15000');
  log.info({ intervalMs }, 'tonListener started');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await pollOnce();
      if (res.enqueued) log.info(res, 'tonListener enqueued jobs');
    } catch (e) {
      log.error({ err: String(e?.message || e) }, 'tonListener poll failed');
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main();
