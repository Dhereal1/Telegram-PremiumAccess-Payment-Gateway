import { setCors, readJson } from '../../lib/http.js'
import { getPool } from '../../lib/db.js'
import { parseTelegramUser, verifyTelegramData } from '../../lib/telegram.js'

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = await readJson(req)
  const initData = body?.initData
  const walletAddress = body?.walletAddress

  if (!initData || typeof initData !== 'string') return res.status(400).json({ error: 'Missing initData' })
  if (!walletAddress || typeof walletAddress !== 'string' || !walletAddress.trim()) return res.status(400).json({ error: 'Missing walletAddress' })

  const maxAgeSeconds = Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || '300')
  const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds })
  if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason })

  const tgUser = parseTelegramUser(initData)
  if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user' })

  const pool = getPool()
  await pool.query(
    `INSERT INTO admins (telegram_id, wallet_address, wallet_verified_at, wallet_verification_nonce)
     VALUES ($1,$2,NOW(),NULL)
     ON CONFLICT (telegram_id) DO UPDATE
     SET wallet_address=EXCLUDED.wallet_address,
         wallet_verified_at=NOW(),
         wallet_verification_nonce=NULL`,
    [String(tgUser.id), String(walletAddress).trim()],
  )

  return res.json({ ok: true, walletAddress: String(walletAddress).trim() })
}

