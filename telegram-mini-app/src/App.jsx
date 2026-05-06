import { useEffect, useMemo, useState } from 'react'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [isTelegram, setIsTelegram] = useState(false)
  const [colorScheme, setColorScheme] = useState(null)
  const [authStatus, setAuthStatus] = useState('idle')
  const [authError, setAuthError] = useState(null)

  const tg = useMemo(() => window.Telegram?.WebApp, [])
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''

  useEffect(() => {
    if (!tg) return

    setIsTelegram(true)
    tg.ready()
    tg.expand()

    setColorScheme(tg.colorScheme ?? null)

    const telegramUser = tg.initDataUnsafe?.user ?? null
    setUser(telegramUser)
  }, [tg])

  useEffect(() => {
    if (!tg?.initData) return
    if (!apiBaseUrl) return

    let cancelled = false

    async function run() {
      try {
        setAuthStatus('loading')
        setAuthError(null)

        const resp = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/auth/telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: tg.initData }),
        })

        const data = await resp.json().catch(() => null)
        if (!resp.ok) throw new Error(data?.error || `Auth failed (${resp.status})`)

        if (!cancelled) {
          setAuthStatus('ok')
          if (data?.user) setUser(data.user)
        }
      } catch (e) {
        if (!cancelled) {
          setAuthStatus('error')
          setAuthError(String(e?.message || e))
        }
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [apiBaseUrl, tg])

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">TON Premium App</h1>
        <p className="subtitle">
          {isTelegram ? 'Running inside Telegram' : 'Open this app from Telegram'}
          {colorScheme ? ` • ${colorScheme}` : ''}
        </p>
      </header>

      <main className="card">
        {user ? (
          <>
            <div className="row">
              <span className="label">Telegram user ID</span>
              <span className="value">{user.id}</span>
            </div>
            <div className="row">
              <span className="label">Username</span>
              <span className="value">{user.username ? `@${user.username}` : '—'}</span>
            </div>
          </>
        ) : (
          <p className="loading">
            {isTelegram
              ? 'Loading Telegram user...'
              : 'No Telegram context detected. Launch via the bot “Open App” button.'}
          </p>
        )}
      </main>

      {isTelegram && tg?.initData ? (
        <footer className="footer">
          <span className="hint">
            initData present ✅{apiBaseUrl ? ` • auth: ${authStatus}` : ' • set VITE_API_BASE_URL to enable auth'}
          </span>
          {authError ? <div className="hint">{authError}</div> : null}
        </footer>
      ) : null}
    </div>
  )
}

export default App
