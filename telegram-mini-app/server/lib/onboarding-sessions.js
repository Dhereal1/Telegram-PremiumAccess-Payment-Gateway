import { getPool } from './db.js'

const STEPS = new Set([
  'awaiting_setup',
  'awaiting_price',
  'awaiting_duration',
  'awaiting_name',
  'awaiting_wallet',
  'awaiting_wallet_verification',
  'complete',
])

export function assertValidStep(step) {
  if (!STEPS.has(step)) throw new Error(`Invalid onboarding step: ${step}`)
}

export async function upsertOnboardingSession({
  adminId,
  telegramChatId,
  step,
  collectedData = {},
}) {
  assertValidStep(step)
  const pool = getPool()
  const r = await pool.query(
    `INSERT INTO onboarding_sessions (admin_id, telegram_chat_id, step, collected_data)
     VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (admin_id, telegram_chat_id)
     DO UPDATE SET step=EXCLUDED.step, collected_data=EXCLUDED.collected_data, updated_at=now()
     RETURNING *`,
    [String(adminId), String(telegramChatId), String(step), JSON.stringify(collectedData || {})],
  )
  return r.rows[0]
}

export async function getOnboardingSession({ adminId, telegramChatId }) {
  const pool = getPool()
  const r = await pool.query(
    `SELECT * FROM onboarding_sessions WHERE admin_id=$1 AND telegram_chat_id=$2`,
    [String(adminId), String(telegramChatId)],
  )
  return r.rows[0] || null
}

export async function deleteOnboardingSession({ adminId, telegramChatId }) {
  const pool = getPool()
  await pool.query(
    `DELETE FROM onboarding_sessions WHERE admin_id=$1 AND telegram_chat_id=$2`,
    [String(adminId), String(telegramChatId)],
  )
}

export async function touchOnboardingSession({ adminId, telegramChatId }) {
  const pool = getPool()
  const r = await pool.query(
    `UPDATE onboarding_sessions SET updated_at=now()
     WHERE admin_id=$1 AND telegram_chat_id=$2
     RETURNING *`,
    [String(adminId), String(telegramChatId)],
  )
  return r.rows[0] || null
}
