import { expect, test } from 'vitest'
import crypto from 'crypto'
import { verifyTelegramData } from '../../api/_lib/telegram.js'

function signInitData(params, botToken) {
  const urlParams = new URLSearchParams(params)
  urlParams.delete('hash')

  const dataCheckString = Array.from(urlParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  const signed = new URLSearchParams(params)
  signed.set('hash', hash)
  return signed.toString()
}

test('rejects old initData (replay protection)', () => {
  const botToken = 'TEST_BOT_TOKEN'
  const now = Math.floor(Date.now() / 1000)

  const initData = signInitData(
    {
      auth_date: String(now - 600),
      query_id: 'AAEAAAE',
      user: JSON.stringify({ id: 123, username: 'u' }),
    },
    botToken,
  )

  const res = verifyTelegramData(initData, botToken, { maxAgeSeconds: 300 })
  expect(res.ok).toBe(false)
})

test('accepts fresh initData', () => {
  const botToken = 'TEST_BOT_TOKEN'
  const now = Math.floor(Date.now() / 1000)

  const initData = signInitData(
    {
      auth_date: String(now - 10),
      query_id: 'AAEAAAE',
      user: JSON.stringify({ id: 123, username: 'u' }),
    },
    botToken,
  )

  const res = verifyTelegramData(initData, botToken, { maxAgeSeconds: 300 })
  expect(res.ok).toBe(true)
})
