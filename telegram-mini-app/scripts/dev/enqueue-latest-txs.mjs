import 'dotenv/config'
import { getTransactions } from '../../server/lib/toncenter.js'
import { getWorkerEnv } from '../../workers/_lib/worker-env.mjs'
import { paymentQueue } from '../../workers/queues/paymentQueue.mjs'
import { connection } from '../../workers/queues/connection.mjs'

async function main() {
  const env = getWorkerEnv()
  const txs = await getTransactions({
    apiUrl: env.TON_API_URL,
    apiKey: env.TON_API_KEY,
    address: env.TON_RECEIVER_ADDRESS,
    limit: Number(process.argv[2] || '10'),
  })

  let enqueued = 0
  for (const tx of txs) {
    const txHash = tx?.transaction_id?.hash || tx?.in_msg?.hash || tx?.hash
    if (!txHash) continue
    // Use a different job id prefix to allow replay even if the original job id existed.
    await paymentQueue.add(
      'verify-payment',
      { tx },
      { jobId: `reverify_${String(txHash)}`, removeOnComplete: true, removeOnFail: false },
    )
    enqueued += 1
  }

  console.log(`enqueued=${enqueued}`)

  // Ensure the process exits on Windows by closing Redis handles.
  await paymentQueue.close()
  await connection.quit()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
