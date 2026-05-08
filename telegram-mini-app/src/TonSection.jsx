import { useCallback, useEffect, useState } from 'react'
import { TonConnectButton, useTonAddress, useTonConnectUI, useTonWallet } from '@tonconnect/ui-react'
import { beginCell, toNano } from '@ton/core'

function TonSection({ user, tg }) {
  const walletAddress = useTonAddress()
  const wallet = useTonWallet()
  const [tonConnectUI] = useTonConnectUI()
  const [walletStatus, setWalletStatus] = useState('idle')
  const [walletError, setWalletError] = useState(null)
  const [payStatus, setPayStatus] = useState('idle')
  const [payError, setPayError] = useState(null)
  const [activeIntent, setActiveIntent] = useState(null)
  const [remoteStatus, setRemoteStatus] = useState(null)
  const [remoteStatusError, setRemoteStatusError] = useState(null)

  const receiverAddress = import.meta.env.VITE_TON_RECEIVER_ADDRESS || 'UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ'
  const tonPriceTon = Number(import.meta.env.VITE_TON_PRICE_TON || '0.1')

  // Prefer backend-provided values once an intent is created (prevents UI drift from build-time env).
  const receiverAddressDisplay = activeIntent?.receiverAddress || receiverAddress
  const tonPriceDisplay = Number(activeIntent?.expectedAmountTon ?? tonPriceTon)

  const fetchUserStatus = useCallback(async () => {
    if (!user?.id) return null
    const resp = await fetch(`/api/user/status/${encodeURIComponent(String(user.id))}`, { method: 'GET' })
    const data = await resp.json().catch(() => null)
    if (!resp.ok) throw new Error(data?.error || `Status failed (${resp.status})`)
    setRemoteStatus(data)
    return data
  }, [user])

  useEffect(() => {
    if (!user?.id) return

    let cancelled = false
    ;(async () => {
      try {
        setRemoteStatusError(null)
        await fetchUserStatus()
      } catch (e) {
        if (!cancelled) setRemoteStatusError(String(e?.message || e))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [fetchUserStatus, user])

  // Poll backend after sending transaction until payment/access is reflected (or timeout).
  useEffect(() => {
    if (payStatus !== 'sent') return
    if (!user?.id) return

    let cancelled = false
    let attempts = 0
    const maxAttempts = 30 // ~2 minutes @ 4s

    const interval = setInterval(async () => {
      attempts += 1
      try {
        setRemoteStatusError(null)
        const data = await fetchUserStatus()
        const paid = Boolean(data?.paid)
        const accessGranted = Boolean(data?.user?.access_granted)
        if (paid || accessGranted) {
          clearInterval(interval)
          if (!cancelled) setPayStatus('confirmed')
          return
        }
      } catch (e) {
        if (!cancelled) setRemoteStatusError(String(e?.message || e))
      }

      if (attempts >= maxAttempts) {
        clearInterval(interval)
        if (!cancelled) setPayStatus('timeout')
      }
    }, 4000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [fetchUserStatus, payStatus, user])

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

    try {
      setPayStatus('sending')
      setPayError(null)

      // Create payment intent first (deterministic matching)
      const intentResp = await fetch('/api/payment-intents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg?.initData }),
      })
      const intentData = await intentResp.json().catch(() => null)
      if (!intentResp.ok) throw new Error(intentData?.error || `Failed to create payment intent (${intentResp.status})`)

      setActiveIntent(intentData)

      const comment = intentData.reference

      const payloadCell = beginCell().storeUint(0, 32).storeStringTail(comment).endCell()
      const payloadBase64 = payloadCell.toBoc().toString('base64')

      const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [
          {
            address: intentData.receiverAddress || receiverAddress,
            amount: toNano(Number(intentData.expectedAmountTon || tonPriceTon)).toString(),
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
    <>
      <section className="card">
        <div className="row">
          <span className="label">Wallet</span>
          <span className="value">{walletAddress ? 'Connected' : 'Not connected'}</span>
        </div>

        <div className="walletActions">
          <TonConnectButton />
        </div>

        {walletAddress ? <p className="mono">{walletAddress}</p> : <p className="loading">Connect a TON wallet.</p>}

        {walletStatus !== 'idle' ? (
          <p className="loading">
            Wallet save: {walletStatus}
            {walletError ? ` • ${walletError}` : ''}
          </p>
        ) : null}
      </section>

      <section className="card">
        <div className="row">
          <span className="label">Payment</span>
          <span className="value">{payStatus === 'idle' ? 'Ready' : payStatus}</span>
        </div>

        <button
          className="payBtn"
          onClick={handlePayment}
          disabled={!walletAddress || payStatus === 'sending' || payStatus === 'sent'}
        >
          {payStatus === 'sending' ? 'Sending…' : `Pay ${tonPriceDisplay} TON`}
        </button>

        <p className="loading">
          Receiver: <span className="mono">{receiverAddressDisplay}</span>
        </p>
        {payError ? <p className="loading">Error: {payError}</p> : null}
        {payStatus === 'sent' ? <p className="loading">Payment request sent. Waiting for confirmation…</p> : null}
        {payStatus === 'confirmed' ? <p className="loading">Payment confirmed ✅</p> : null}
        {payStatus === 'timeout' ? (
          <p className="loading">Still waiting. If you paid, keep this page open and it should confirm shortly.</p>
        ) : null}
        {activeIntent?.intentId ? (
          <p className="loading">
            Intent: <span className="mono">{activeIntent.intentId}</span>
          </p>
        ) : null}

        {remoteStatusError ? <p className="loading">Status error: {remoteStatusError}</p> : null}
        {remoteStatus?.exists ? (
          <p className="loading">
            Access: <span className="mono">{remoteStatus.user?.access_granted ? 'granted' : 'not granted'}</span>
            {' · '}
            Paid: <span className="mono">{remoteStatus.paid ? 'true' : 'false'}</span>
          </p>
        ) : null}

        {remoteStatus?.user?.last_invite_link ? (
          <p className="loading">
            Invite:{' '}
            <a href={remoteStatus.user.last_invite_link} target="_blank" rel="noreferrer">
              open link
            </a>
          </p>
        ) : null}
      </section>
    </>
  )
}

export default TonSection
