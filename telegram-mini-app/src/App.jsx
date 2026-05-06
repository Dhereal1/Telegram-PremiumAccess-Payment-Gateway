import { useEffect, useMemo, useState } from 'react'
import { TonConnectButton, useTonAddress, useTonConnectUI, useTonWallet } from '@tonconnect/ui-react'
import { beginCell, toNano } from '@ton/core'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [isTelegram, setIsTelegram] = useState(false)
  const [colorScheme, setColorScheme] = useState(null)
  const [authStatus, setAuthStatus] = useState('idle')
  const [authError, setAuthError] = useState(null)
  const walletAddress = useTonAddress()
  const wallet = useTonWallet()
  const [tonConnectUI] = useTonConnectUI()
  const [walletStatus, setWalletStatus] = useState('idle')
  const [walletError, setWalletError] = useState(null)
  const [payStatus, setPayStatus] = useState('idle')
  const [payError, setPayError] = useState(null)

  const tg = useMemo(() => window.Telegram?.WebApp, [])

  const receiverAddress = import.meta.env.VITE_TON_RECEIVER_ADDRESS || 'UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ'
  const tonPriceTon = Number(import.meta.env.VITE_TON_PRICE_TON || '0.1')

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
  }, [tg])

  useEffect(() => {
    if (!walletAddress) return
    if (!user?.id) return

    let cancelled = false

    async function run() {
      try {
        setWalletStatus('saving')
        setWalletError(null)

        const resp = await fetch(`/api/user/wallet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: tg?.initData, wallet_address: walletAddress }),
        })

        const data = await resp.json().catch(() => null)
        if (!resp.ok) throw new Error(data?.error || `Save failed (${resp.status})`)

        if (!cancelled) setWalletStatus('saved')
      } catch (e) {
        if (!cancelled) {
          setWalletStatus('error')
          setWalletError(String(e?.message || e))
        }
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [tg, user?.id, walletAddress])

  const handlePayment = async () => {
    if (!walletAddress) {
      setPayStatus('error')
      setPayError('Connect wallet first')
      return
    }

    if (!tg?.initDataUnsafe?.user?.id && !user?.id) {
      setPayStatus('error')
      setPayError('Telegram user not loaded')
      return
    }

    try {
      setPayStatus('sending')
      setPayError(null)

      const telegramId = String(user?.id ?? tg.initDataUnsafe?.user?.id)
      const timestamp = Date.now()
      const comment = `tp:${telegramId}|ts:${timestamp}`

      const payloadCell = beginCell().storeUint(0, 32).storeStringTail(comment).endCell()
      const payloadBase64 = payloadCell.toBoc().toString('base64')

      const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [
          {
            address: receiverAddress,
            amount: toNano(tonPriceTon).toString(),
            payload: payloadBase64,
          },
        ],
        ...(wallet?.account?.address ? { from: wallet.account.address } : {}),
      }

      await tonConnectUI.sendTransaction(transaction)
      setPayStatus('sent')
    } catch (e) {
      setPayStatus('error')
      setPayError(String(e?.message || e))
    }
  }

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

      <section className="card">
        <div className="row">
          <span className="label">Wallet</span>
          <span className="value">{walletAddress ? 'Connected' : 'Not connected'}</span>
        </div>

        <div className="walletActions">
          <TonConnectButton />
        </div>

        {walletAddress ? (
          <p className="mono">{walletAddress}</p>
        ) : (
          <p className="loading">Connect a TON wallet to continue.</p>
        )}

        {walletStatus !== 'idle' ? (
          <p className="loading">Wallet save: {walletStatus}{walletError ? ` • ${walletError}` : ''}</p>
        ) : null}
      </section>

      <section className="card">
        <div className="row">
          <span className="label">Payment</span>
          <span className="value">{payStatus === 'idle' ? 'Ready' : payStatus}</span>
        </div>

        <button className="payBtn" onClick={handlePayment} disabled={!walletAddress || payStatus === 'sending'}>
          {payStatus === 'sending' ? 'Sending…' : `Pay ${tonPriceTon} TON`}
        </button>

        <p className="loading">
          Receiver: <span className="mono">{receiverAddress}</span>
        </p>
        {payError ? <p className="loading">Error: {payError}</p> : null}
        {payStatus === 'sent' ? <p className="loading">Payment request sent. Waiting for confirmation…</p> : null}
      </section>

      {isTelegram && tg?.initData ? (
        <footer className="footer">
          <span className="hint">
            initData present ✅ • auth: {authStatus}
          </span>
          {authError ? <div className="hint">{authError}</div> : null}
        </footer>
      ) : null}
    </div>
  )
}

export default App
