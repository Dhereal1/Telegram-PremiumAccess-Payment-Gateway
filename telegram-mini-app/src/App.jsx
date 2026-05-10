import { useEffect, useMemo, useState } from 'react'
import './App.css'

function App() {
  const [tgUser, setTgUser] = useState(null)
  const [dbUser, setDbUser] = useState(null)
  const [colorScheme, setColorScheme] = useState(null)
  const [authStatus, setAuthStatus] = useState('idle')
  const [authError, setAuthError] = useState(null)
  const [clientError, setClientError] = useState(null)

  const tg = useMemo(() => window.Telegram?.WebApp, [])
  const isTelegram = Boolean(tg)
  const isAdminView = useMemo(() => {
    try {
      const p = new URLSearchParams(window.location.search)
      return p.get('admin') === '1'
    } catch {
      return false
    }
  }, [])

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
    setTgUser(telegramUser)
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
          if (data?.user) setDbUser(data.user)
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
  const [adminUiState, setAdminUiState] = useState({ status: 'idle', Component: null, error: null })

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

  useEffect(() => {
    if (!isAdminView) return
    let cancelled = false
    async function load() {
      try {
        setAdminUiState({ status: 'loading', Component: null, error: null })
        const mod = await import('./pages/AdminDashboard.jsx')
        if (!cancelled) setAdminUiState({ status: 'ready', Component: mod.default, error: null })
      } catch (e) {
        if (!cancelled) setAdminUiState({ status: 'error', Component: null, error: String(e?.message || e) })
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [isAdminView])

  const welcomeName = tgUser?.first_name || tgUser?.username || 'there'

  const groupLabel = useMemo(() => {
    try {
      const p = new URLSearchParams(window.location.search)
      const g = String(p.get('g') || '').trim()
      const m = g.match(/^([a-z0-9_-]{1,50})_([0-9a-fA-F-]{36})$/i)
      if (!m) return null
      const slug = String(m[1] || '')
        .replace(/[_-]+/g, ' ')
        .trim()
      if (!slug) return null
      return slug.replace(/\b\w/g, (c) => c.toUpperCase())
    } catch {
      return null
    }
  }, [])

  const authChip = useMemo(() => {
    const label =
      authStatus === 'ok'
        ? 'Authenticated'
        : authStatus === 'error'
          ? 'Auth error'
          : authStatus === 'loading'
            ? 'Authenticating'
            : 'Auth idle'
    const cls =
      authStatus === 'ok'
        ? 'status-success'
        : authStatus === 'error'
          ? 'status-error'
          : authStatus === 'loading'
            ? 'status-pending'
            : 'status-info'
    return (
      <span className={`chip ${cls}`}>
        <span className="chipDot" />
        {label}
      </span>
    )
  }, [authStatus])

  return (
    <div className="app">
      <header className="header">
        <div className="card hero">
          <h1 className="heroTitle">
            <span className="gradientText">💎 TON Premium</span>
          </h1>
          {groupLabel ? (
            <div style={{ marginTop: 8 }}>
              <span className="chip status-info">
                <span className="chipDot" />
                {groupLabel}
              </span>
            </div>
          ) : null}
          <p className="subtitle">
            {isTelegram ? 'Running inside Telegram' : 'Open this app from Telegram'}
          </p>
        </div>
      </header>

      <main className="card">
        {tgUser ? (
          <>
            <p className="loading" style={{ marginBottom: 10 }}>
              Welcome, <strong>{welcomeName}</strong>!
            </p>

            <div className="row">
              <span className="label">Status</span>
              <span className="value">{authChip}</span>
            </div>

            <details className="details">
              <summary>Debug info</summary>
              <div style={{ marginTop: 10 }}>
                <div className="row">
                  <span className="label">Telegram user ID</span>
                  <span className="value">{tgUser.id}</span>
                </div>
                <div className="row">
                  <span className="label">Username</span>
                  <span className="value">{tgUser.username ? `@${tgUser.username}` : '—'}</span>
                </div>
                {dbUser?.telegram_id ? (
                  <div className="row">
                    <span className="label">DB telegram_id</span>
                    <span className="value">{dbUser.telegram_id}</span>
                  </div>
                ) : null}
              </div>
            </details>
          </>
        ) : (
          <p className="loading">
            {isTelegram
              ? 'Loading Telegram user...'
              : 'No Telegram context detected. Launch via the bot "Open App" button.'}
          </p>
        )}
      </main>

      {isAdminView ? (
        adminUiState.status === 'ready' ? (
          (() => {
            const AdminDashboard = adminUiState.Component
            return <AdminDashboard tg={tg} />
          })()
        ) : adminUiState.status === 'error' ? (
          <section className="card">
            <p className="loading">Admin UI failed to load: {adminUiState.error}</p>
          </section>
        ) : (
          <section className="card">
            <p className="loading">Loading admin dashboard…</p>
          </section>
        )
      ) : tonUiState.status === 'ready' ? (
        (() => {
          const TonSection = tonUiState.Component
          return <TonSection user={tgUser} tg={tg} dbUser={dbUser} />
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
