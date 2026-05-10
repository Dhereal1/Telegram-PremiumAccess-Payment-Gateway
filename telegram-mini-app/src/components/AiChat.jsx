import { useEffect, useMemo, useRef, useState } from 'react'

function fmtTime(ts) {
  try {
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return ''
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  } catch {
    return ''
  }
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
  const listRef = useRef(null)

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lastFive.length, status])

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
    setMessages((m) => [...m, { role: 'user', text, ts: Date.now() }].slice(-10))

    try {
      const resp = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, groupId, message: text }),
      })
      const data = await resp.json().catch(() => null)
      if (!resp.ok) throw new Error(data?.error || `AI request failed (${resp.status})`)
      const reply = String(data?.reply || '').trim() || 'AI assistant is not available right now.'
      setMessages((m) => [...m, { role: 'assistant', text: reply, ts: Date.now() }].slice(-10))
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

      <div className="chatWrap" style={{ marginTop: 8 }}>
        <div className="chatBody" ref={listRef}>
          {lastFive.length ? (
            lastFive.map((m, idx) => {
              const isUser = m.role === 'user'
              return (
                <div key={idx} className={`chatRow ${isUser ? 'chatRowUser' : 'chatRowBot'}`}>
                  {!isUser ? <div className="botAvatar">🤖</div> : null}
                  <div className={isUser ? 'bubbleUser' : 'bubbleBot'}>
                    {m.text}
                    <div className={`bubbleMeta ${isUser ? '' : 'bubbleMetaLeft'}`}>{fmtTime(m.ts || Date.now())}</div>
                  </div>
                </div>
              )
            })
          ) : (
            <p className="loading status-info">👋 Hi! Ask me anything about your subscription.</p>
          )}

          {status === 'loading' ? (
            <div className="chatRow chatRowBot">
              <div className="botAvatar">🤖</div>
              <div className="bubbleBot">
                <span className="typingDots">
                  <span />
                  <span />
                  <span />
                </span>
                <div className="bubbleMeta bubbleMetaLeft">{fmtTime(Date.now())}</div>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="chatRow chatRowBot">
              <div className="botAvatar">⚠️</div>
              <div className="bubbleBot" style={{ borderColor: 'rgba(248, 113, 113, 0.35)' }}>
                <span className="status-error">Error: {error}</span>
                <div className="bubbleMeta bubbleMetaLeft">{fmtTime(Date.now())}</div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="chatComposer">
          <div className="chatInputWrap">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={500}
              placeholder="Ask a question…"
              className="chatInput"
              onKeyDown={(e) => {
                if (e.key === 'Enter') send()
              }}
            />
            <div className="counter">
              {input.length}/500
            </div>
          </div>
          <button className="iconBtn" onClick={send} disabled={!canSend} aria-label="Send">
            ➤
          </button>
        </div>
      </div>
    </section>
  )
}
