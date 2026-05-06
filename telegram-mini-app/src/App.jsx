import { useEffect, useMemo, useState } from 'react'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [colorScheme, setColorScheme] = useState(null)
  const [authStatus, setAuthStatus] = useState('idle')
  const [authError, setAuthError] = useState(null)
  const [clientError, setClientError] = useState(null)

  const tg = useMemo(() => window.Telegram?.WebApp, [])
  const isTelegram = Boolean(tg)

  useEffect(() => {
    function onError(event) {
      const message = event?.error?.message || event?.message || 'Unknown error'
      setClientError(message)
    }

    function onRejection(event) {
      const message = event?.reason?.message || String(event?.reason || 'Unhandled rejection')
      setClientError(message)
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  useEffect(() => {
    if (!tg) return

    tg.ready()
    tg.expand()

    setColorScheme(tg.colorScheme ?? null)

    const telegramUser = tg.initDataUnsafe?.user ?? null
    setUser(telegramUser)
  }, [tg])

  useEffect(() => {
    if (!tg?.initData) return

    let cancelled = false

    async function run() {
      try {
        setAuthStatus('loading')
        setAuthError(null)

        const resp = await fetch(`/api/auth/telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: tg.initData }),
        })

        const data = await resp.json().catch(() => null)
        if (!resp.ok) {
          const msg = data?.reason ? `${data?.error || 'Auth failed'}: ${data.reason}` : data?.error || `Auth failed (${resp.status})`
          throw new Error(msg)
        }

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
  }, [tg])

  const [tonUiState, setTonUiState] = useState({ status: 'loading', Component: null, error: null })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const mod = await import('./TonSection.jsx')
        if (!cancelled) setTonUiState({ status: 'ready', Component: mod.default, error: null })
      } catch (e) {
        if (!cancelled) setTonUiState({ status: 'error', Component: null, error: String(e?.message || e) })
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

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

      {tonUiState.status === 'ready' ? (
        (() => {
          const TonSection = tonUiState.Component
          return <TonSection user={user} tg={tg} />
        })()
      ) : tonUiState.status === 'error' ? (
        <section className="card">
          <p className="loading">TON UI failed to load: {tonUiState.error}</p>
        </section>
      ) : (
        <section className="card">
          <p className="loading">Loading TON features…</p>
        </section>
      )}

      {isTelegram && tg?.initData ? (
        <footer className="footer">
          <span className="hint">
            initData present ✅ • auth: {authStatus}
          </span>
          {authError ? <div className="hint">{authError}</div> : null}
          {clientError ? <div className="hint">Client error: {clientError}</div> : null}
        </footer>
      ) : null}
    </div>
  )
}

export default App
