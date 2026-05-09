import { getEnv } from './env.js'

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'

function getGroqKey() {
  const env = getEnv()
  const key = String(env.GROQ_API_KEY || '').trim()
  return key || null
}

export async function chatComplete({ system, user, maxTokens = 200 }) {
  const apiKey = getGroqKey()
  if (!apiKey) return null

  const max_tokens = Math.min(300, Math.max(1, Number(maxTokens) || 200))

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama3-8b-8192',
        temperature: 0.7,
        max_tokens,
        messages: [
          { role: 'system', content: String(system || '') },
          { role: 'user', content: String(user || '') },
        ],
      }),
      signal: controller.signal,
    })

    const data = await res.json().catch(() => null)
    const text = data?.choices?.[0]?.message?.content
    if (!res.ok || !text) return null
    return String(text).trim() || null
  } catch (e) {
    // Caller can decide whether to fail open or return a fallback message.
    // Throwing here improves observability in serverless logs.
    throw e
  } finally {
    clearTimeout(timeout)
  }
}
