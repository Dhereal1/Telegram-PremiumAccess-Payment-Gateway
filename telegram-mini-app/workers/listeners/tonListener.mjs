import { getDb } from '../_lib/db.mjs'
import { getWorkerEnv } from '../_lib/worker-env.mjs'
import { getWorkerLogger } from '../_lib/logger.mjs'
import { pathToFileURL } from 'node:url'
import { getTransactions, getTxCursor } from '../../server/lib/toncenter.js'
import { enqueuePaymentVerification } from '../producers/enqueuePaymentVerification.mjs'

const env = getWorkerEnv();
const log = getWorkerLogger();
const pool = getDb();

log.info(
  {
    tonApiUrl: env.TON_API_URL,
    hasTonApiKey: Boolean(env.TON_API_KEY && env.TON_API_KEY.length > 0),
    receiverHasColon: Boolean(env.TON_RECEIVER_ADDRESS && env.TON_RECEIVER_ADDRESS.includes(':')),
    receiverLen: env.TON_RECEIVER_ADDRESS ? env.TON_RECEIVER_ADDRESS.length : 0,
  },
  'tonListener env',
);

async function getCursor() {
  const id = `ton:${env.TON_RECEIVER_ADDRESS}`
  const row = await pool.query('SELECT last_lt, last_hash FROM blockchain_cursors WHERE id=$1', [id])
  const cur = row.rows[0] || {}
  return { id, lastLt: cur.last_lt ? String(cur.last_lt) : null, lastHash: cur.last_hash || null }
}

async function saveCursor(id, cur) {
  if (!cur?.lt || !cur?.hash) return
  await pool.query(
    `INSERT INTO blockchain_cursors (id, last_lt, last_hash, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET last_lt=EXCLUDED.last_lt, last_hash=EXCLUDED.last_hash, updated_at=NOW()`,
    [id, String(cur.lt), String(cur.hash)]
  )
}

async function pollOnce() {
  const { id, lastLt, lastHash } = await getCursor();
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

    // Update cursor sequentially only after enqueue succeeds (prevents gaps on restart)
    const cur = getTxCursor(tx)
    if (cur) await saveCursor(id, cur)
  }

  return { enqueued, newestSeen, scanned: collected.length };
}

async function main() {
  const intervalMs = Number(process.env.TON_LISTENER_INTERVAL_MS || '15000');
  log.info({ intervalMs }, 'tonListener started');

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

export { pollOnce };

// Only start the long-running listener when executed directly (not when imported by serverless routes).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
