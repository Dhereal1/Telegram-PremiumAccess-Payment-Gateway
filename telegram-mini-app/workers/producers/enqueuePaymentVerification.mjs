import { paymentQueue } from '../queues/paymentQueue.mjs'

export async function enqueuePaymentVerification({ tx }) {
  const txHash = tx?.transaction_id?.hash || tx?.in_msg?.hash || tx?.hash
  if (!txHash) throw new Error('Missing tx hash')

  await paymentQueue.add(
    'verify-payment',
    { tx },
    { jobId: `tx:${String(txHash)}` }
  )
}

