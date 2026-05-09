import { setCors, readJson } from '../../lib/http.js'
import { parseTelegramUser, verifyTelegramData } from '../../lib/telegram.js'
import { parseJson } from '../../lib/validation.js'
import { z } from 'zod'
import { upsertAdminWallet } from '../../lib/groups.js'
import crypto from 'crypto'
import { getPool } from '../../lib/db.js'

const BodySchema = z.object({
  initData: z.string().min(1),
  wallet_address: z.string().min(1),
})

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = await readJson(req)
  const { initData, wallet_address } = parseJson(body, BodySchema)

  const verify = verifyTelegramData(initData, process.env.BOT_TOKEN, { maxAgeSeconds: 300 })
  if (!verify.ok) return res.status(401).json({ error: 'Invalid Telegram data', reason: verify.reason })

  const tgUser = parseTelegramUser(initData)
  if (!tgUser?.id) return res.status(400).json({ error: 'Missing Telegram user' })

  const admin = await upsertAdminWallet({ adminTelegramId: String(tgUser.id), walletAddress: wallet_address })

  // Initiate verification challenge for this wallet (proof-of-control).
  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  const pool = getPool()
  await pool.query(
    `UPDATE admins SET wallet_verification_nonce=$2, wallet_verification_requested_at=NOW(), wallet_verified_at=NULL WHERE telegram_id=$1`,
    [String(tgUser.id), String(nonce)],
  )

  return res.json({
    ok: true,
    admin: { telegram_id: admin.telegram_id, wallet_address: admin.wallet_address, wallet_verified: Boolean(admin.wallet_verified_at) },
    verification: {
      platformWalletAddress: String(process.env.PLATFORM_WALLET_ADDRESS || ''),
      comment: `verify_admin:${String(tgUser.id)}:${nonce}`,
      minTon: Number(process.env.WALLET_VERIFY_MIN_TON || '0.001'),
    },
  })
}
