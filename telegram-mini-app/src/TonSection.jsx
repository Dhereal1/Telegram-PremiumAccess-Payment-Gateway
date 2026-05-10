import { useCallback, useEffect, useState } from 'react'
import { TonConnectButton, useTonAddress, useTonConnectUI, useTonWallet } from '@tonconnect/ui-react'
import { beginCell, toNano } from '@ton/core'
import AiChat from './components/AiChat.jsx'

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

  const params = new URLSearchParams(window.location.search)
  const groupId = params.get('g') || params.get('groupId') || tg?.initDataUnsafe?.start_param || null

  // Multi-tenant only: receiver and price come from the backend intent.
  const receiverAddressDisplay = activeIntent?.receiverAddress || '—'
  const tonPriceDisplay = activeIntent?.expectedAmountTon != null ? Number(activeIntent.expectedAmountTon) : null

  function truncateAddr(addr) {
    const a = String(addr || '').trim()
    if (!a) return '—'
    if (a.length <= 14) return a
    return `${a.slice(0, 6)}…${a.slice(-4)}`
  }

  function fmtDate(d) {
    try {
      const dt = d ? new Date(d) : null
      if (!dt || Number.isNaN(dt.getTime())) return null
      return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    } catch {
      return null
    }
  }

  function groupDisplayName() {
    const g = String(params.get('g') || '').trim()
    const m = g.match(/^([a-z0-9_-]{1,50})_([0-9a-fA-F-]{36})$/i)
    if (!m) return null
    const slug = String(m[1] || '')
      .replace(/[_-]+/g, ' ')
      .trim()
    if (!slug) return null
    return slug.replace(/\b\w/g, (c) => c.toUpperCase())
  }

  const membership = remoteStatus?.membership || null
  const hasMembership = Boolean(remoteStatus?.exists && membership)
  const expiresLabel = membership?.expiry_date ? fmtDate(membership.expiry_date) : remoteStatus?.expiry ? fmtDate(remoteStatus.expiry) : null
  const subscriptionStatus = String(membership?.subscription_status || '').trim() || (remoteStatus?.paid ? 'active' : 'inactive')
  const accessGranted = Boolean(remoteStatus?.accessGranted ?? membership?.access_granted)
  const paid = Boolean(remoteStatus?.paid)

  function chipForStatus(s) {
    const v = String(s || '').toLowerCase()
    const cls =
      v === 'active'
        ? 'status-success'
        : v === 'expired'
          ? 'status-error'
          : v === 'inactive'
            ? 'status-info'
            : 'status-pending'
    return (
      <span className={`chip ${cls}`}>
        <span className="chipDot" />
        {s}
      </span>
    )
  }

  function payStatusChip() {
    if (payStatus === 'confirmed') return chipForStatus('confirmed')
    if (payStatus === 'error') return chipForStatus('error')
    if (payStatus === 'sent' || payStatus === 'sending' || payStatus === 'timeout') return chipForStatus('pending')
    return chipForStatus('ready')
  }

  const fetchUserStatus = useCallback(async () => {
    if (!user?.id) return null
    const qs = groupId ? `?groupId=${encodeURIComponent(String(groupId))}` : ''
    const resp = await fetch(`/api/user/status/${encodeURIComponent(String(user.id))}${qs}`, {
      method: 'GET',
      headers: tg?.initData ? { 'x-telegram-init-data': tg.initData } : undefined,
    })
    const data = await resp.json().catch(() => null)
    if (!resp.ok) throw new Error(data?.error || `Status failed (${resp.status})`)
    setRemoteStatus(data)
    return data
  }, [groupId, tg, user])

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
        const accessGranted = Boolean(groupId ? data?.membership?.access_granted : data?.user?.access_granted)
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
    if (!tg?.initData) {
      setPayStatus('error')
      setPayError('Open this Mini App from Telegram (via the bot).')
      return
    }
    if (!groupId) {
      setPayStatus('error')
      setPayError('Missing group id. Open this Mini App via a group-specific link.')
      return
    }
    if (!walletAddress) {
      setPayStatus('error')
      setPayError('Connect wallet first')
      return
    }

    try {
      setPayStatus('sending')
      setPayError(null)
      setActiveIntent(null)

      // Create payment intent first (deterministic matching)
      const intentResp = await fetch('/api/payment-intents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg?.initData, ...(groupId ? { groupId } : {}) }),
      })
      const intentData = await intentResp.json().catch(() => null)
      if (!intentResp.ok) {
        const msg = intentData?.reason ? `${intentData?.error || 'Payment intent failed'}: ${intentData.reason}` : (intentData?.error || `Failed to create payment intent (${intentResp.status})`)
        throw new Error(msg)
      }

      setActiveIntent(intentData)

      const comment = intentData.reference
      const receiver = String(intentData.receiverAddress || '').trim()
      if (!receiver) throw new Error('Missing receiver address. Please contact the group admin.')
      if (intentData.expectedAmountTon == null) throw new Error('Missing expected amount. Please try again.')

      const payloadCell = beginCell().storeUint(0, 32).storeStringTail(comment).endCell()
      const payloadBase64 = payloadCell.toBoc().toString('base64')

      const platformWalletAddress = intentData?.platformWalletAddress || null
      const platformFeeTon = intentData?.platformFeeTon != null ? String(intentData.platformFeeTon) : null
      const adminAmountTon = intentData?.adminAmountTon != null ? String(intentData.adminAmountTon) : null
      const feePct = Number(intentData?.platformFeePercent || 0)

      const messages =
        groupId && platformWalletAddress && feePct > 0 && platformFeeTon && adminAmountTon
          ? [
              {
                address: platformWalletAddress,
                amount: toNano(platformFeeTon).toString(),
                payload: payloadBase64,
              },
              {
                address: receiver,
                amount: toNano(adminAmountTon).toString(),
                payload: payloadBase64,
              },
            ]
          : [
              {
                address: receiver,
                amount: toNano(String(intentData.expectedAmountTon)).toString(),
                payload: payloadBase64,
              },
            ]

      const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages,
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
        <p className="sectionTitle">Wallet</p>
        <div className="row">
          <span className="label">Wallet</span>
          <span className="value">{walletAddress ? 'Connected' : 'Not connected'}</span>
        </div>

        <div className="walletActions">
          <TonConnectButton />
        </div>

        {walletAddress ? (
          <p className="mono">{truncateAddr(walletAddress)}</p>
        ) : (
          <p className="loading status-info">Connect a TON wallet.</p>
        )}

        {walletStatus !== 'idle' ? (
          <p
            className={`loading ${
              walletStatus === 'saved' ? 'status-success' : walletStatus === 'error' ? 'status-error' : 'status-pending'
            }`}
          >
            Wallet save: {walletStatus}
            {walletError ? ` • ${walletError}` : ''}
          </p>
        ) : null}
      </section>

      <section className="card">
        <p className="sectionTitle">{groupDisplayName() ? `Subscription • ${groupDisplayName()}` : 'Subscription'}</p>

        {hasMembership ? (
          <>
            <div className="row">
              <span className="label">Status</span>
              <span className="value">{chipForStatus(subscriptionStatus || 'active')}</span>
            </div>
            <div className="row">
              <span className="label">Access</span>
              <span className="value">
                {accessGranted ? <span className="status-success">✅ Granted</span> : <span className="status-error">❌ Not granted</span>}
              </span>
            </div>
            <div className="row">
              <span className="label">Expiry</span>
              <span className="value">{expiresLabel ? `Expires ${expiresLabel}` : '—'}</span>
            </div>
          </>
        ) : remoteStatusError ? (
          <p className="loading status-error">Status error: {remoteStatusError}</p>
        ) : (
          <p className="loading status-info">Checking subscription status…</p>
        )}

        {membership?.last_invite_link ? (
          <div className="inviteBox">
            <div className="row" style={{ paddingTop: 0 }}>
              <span className="label">Invite link</span>
              <span className="value">{paid ? <span className="status-success">Ready</span> : <span className="status-pending">Pending</span>}</span>
            </div>
            <div className="inviteActions">
              <a
                className="gradientBtn"
                href={membership.last_invite_link}
                target="_blank"
                rel="noreferrer"
                style={{ textAlign: 'center', textDecoration: 'none' }}
              >
                Join Group
              </a>
            </div>
          </div>
        ) : null}
      </section>

      <section className="card">
        <p className="sectionTitle">Payment</p>
        <div className="row">
          <span className="label">Payment</span>
          <span className="value">{payStatusChip()}</span>
        </div>

        <button
          className="gradientBtn"
          onClick={handlePayment}
          disabled={!walletAddress || payStatus === 'sending' || payStatus === 'sent'}
        >
          {payStatus === 'sending'
            ? 'Sending…'
            : tonPriceDisplay != null
              ? `Pay ${tonPriceDisplay} TON`
              : 'Pay with TON'}
        </button>

        {payError ? <p className="loading status-error">Error: {payError}</p> : null}
        {payStatus === 'sent' ? (
          <p className="loading status-pending" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="spinner" /> Waiting for confirmation…
          </p>
        ) : null}
        {payStatus === 'confirmed' ? (
          <p className="loading status-success">
            Payment confirmed <span className="pulseOk">✅</span>
          </p>
        ) : null}
        {payStatus === 'timeout' ? (
          <p className="loading status-pending">Still waiting. If you paid, keep this page open and it should confirm shortly.</p>
        ) : null}

        <details className="details">
          <summary>Debug info</summary>
          <div style={{ marginTop: 10 }}>
            <div className="row">
              <span className="label">Receiver</span>
              <span className="value">
                <span className="mono">{receiverAddressDisplay}</span>
              </span>
            </div>
            {activeIntent?.intentId ? (
              <div className="row">
                <span className="label">Intent</span>
                <span className="value">
                  <span className="mono">{activeIntent.intentId}</span>
                </span>
              </div>
            ) : null}
            <div className="row">
              <span className="label">Paid</span>
              <span className="value">{paid ? 'true' : 'false'}</span>
            </div>
            <div className="row">
              <span className="label">Access granted</span>
              <span className="value">{accessGranted ? 'true' : 'false'}</span>
            </div>
            {remoteStatusError ? <p className="loading status-error">Status error: {remoteStatusError}</p> : null}
          </div>
        </details>
      </section>

      <AiChat tg={tg} groupId={groupId} />
    </>
  )
}

export default TonSection
