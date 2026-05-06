export function startQueueStatsLogger({ logger, queueName, queue }) {
  const intervalMs = Number(process.env.QUEUE_STATS_INTERVAL_MS || '60000')

  setInterval(async () => {
    try {
      const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed')
      logger.info({ queue: queueName, counts }, 'queue_stats')
    } catch (e) {
      logger.warn({ queue: queueName, err: String(e?.message || e) }, 'queue_stats_failed')
    }
  }, intervalMs).unref?.()
}

