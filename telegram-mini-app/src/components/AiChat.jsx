import { useMemo, useState } from 'react'

function Bubble({ role, text }) {
  const isUser = role === 'user'
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        margin: '6px 0',
      }}
    >
      <div
        style={{
          maxWidth: '85%',
          padding: '10px 12px',
          borderRadius: 12,
          background: isUser ? 'rgba(0, 122, 255, 0.20)' : 'rgba(255, 255, 255, 0.06)',
          border: '1px solid rgba(255,255,255,0.08)',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.35,
        }}
      >
        {text}
      </div>
    </div>
  )
}

export default function AiChat({ tg, groupId }) {
  const initData = tg?.initData || ''
  const enabled = Boolean(groupId)

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)

  const canSend = enabled && status !== 'loading' && input.trim().length > 0
  const lastFive = useMemo(() => messages.slice(-10), [messages]) // 5 turns => 10 msgs

  async function send() {
    const text = input.trim()
    if (!text) return
    if (text.length > 500) {
      setError('Message too long (max 500 chars).')
      return
    }

    setStatus('loading')
    setError(null)
    setInput('')
    setMessages((m) => [...m, { role: 'user', text }].slice(-10))

    try {
      const resp = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, groupId, message: text }),
      })
      const data = await resp.json().catch(() => null)
      if (!resp.ok) throw new Error(data?.error || `AI request failed (${resp.status})`)
      const reply = String(data?.reply || '').trim() || 'AI assistant is not available right now.'
      setMessages((m) => [...m, { role: 'assistant', text: reply }].slice(-10))
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setStatus('idle')
    }
  }

  if (!enabled) return null

  return (
    <section className="card">
      <div className="row">
        <span className="label">Assistant</span>
        <span className="value">{status === 'loading' ? 'Thinking…' : 'Ready'}</span>
      </div>

      <div style={{ marginTop: 8 }}>
        {lastFive.length ? (
          lastFive.map((m, idx) => <Bubble key={idx} role={m.role} text={m.text} />)
        ) : (
          <p className="loading">Ask about this group, subscriptions, or TON payments.</p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
          placeholder="Ask a question…"
          style={{
            flex: 1,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.10)',
            background: 'rgba(255,255,255,0.04)',
            color: 'inherit',
            outline: 'none',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send()
          }}
        />
        <button className="payBtn" onClick={send} disabled={!canSend}>
          Send
        </button>
      </div>

      {error ? <p className="loading">Error: {error}</p> : null}
    </section>
  )
}

