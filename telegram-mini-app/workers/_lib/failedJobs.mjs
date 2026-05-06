import { getDb } from './db.mjs'

export async function logFailedJob({ jobId, queue, payload, error }) {
  const pool = getDb()
  await pool.query(
    `INSERT INTO failed_jobs (job_id, queue_name, payload, error)
     VALUES ($1, $2, $3, $4)`,
    [jobId ? String(jobId) : null, String(queue), payload ? JSON.stringify(payload) : null, String(error)]
  )
}

