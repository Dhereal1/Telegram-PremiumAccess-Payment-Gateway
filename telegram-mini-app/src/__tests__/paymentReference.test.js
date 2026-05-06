import { describe, expect, test } from 'vitest'

function extractTelegramId(comment) {
  const m = String(comment || '').match(/(?:^|\s|\|)tp:(\d+)(?:\||\s|$)/)
  return m ? m[1] : null
}

function extractIntentId(comment) {
  const m = String(comment || '').match(/(?:^|\s|\|)pi:([0-9a-fA-F-]{36})(?:\||\s|$)/)
  return m ? m[1] : null
}

describe('payment reference parsing', () => {
  test('extracts tp and pi', () => {
    const c = 'tp:123|pi:550e8400-e29b-41d4-a716-446655440000'
    expect(extractTelegramId(c)).toBe('123')
    expect(extractIntentId(c)).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  test('returns null when missing', () => {
    expect(extractTelegramId('pi:550e8400-e29b-41d4-a716-446655440000')).toBe(null)
    expect(extractIntentId('tp:123')).toBe(null)
  })
})
