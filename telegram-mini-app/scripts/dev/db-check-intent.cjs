require('dotenv').config()
const { Pool } = require('pg')

async function main() {
  const intentId = process.argv[2]
  if (!intentId) {
    console.error('Usage: node scripts/dev/db-check-intent.cjs <payment_intent_id>')
    process.exit(2)
  }

  if (!process.env.DATABASE_URL) {
    console.error('Missing DATABASE_URL in env')
    process.exit(2)
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const r = await pool.query(
      'SELECT id, telegram_id, status, created_at, expires_at, tx_hash, expected_amount_ton, receiver_address FROM payment_intents WHERE id=$1',
      [String(intentId)],
    )
    console.log(r.rows[0] || null)
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

