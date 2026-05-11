import { useEffect, useMemo, useState } from 'react'
import { TonConnectButton, useTonAddress } from '@tonconnect/ui-react'

function slugifyGroupName(name) {
  return (
    String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'group'
  )
}

function buildBotDeepLink({ botUsername, groupName, groupId }) {
  const u = String(botUsername || '').replace(/^@/, '').trim()
  if (!u) return null
  const start = `g_${slugifyGroupName(groupName)}_${String(groupId)}`
  return `https://t.me/${u}?start=${encodeURIComponent(start)}`
}

function AdminDashboard({ tg }) {
  const initData = tg?.initData || ''
  const botUsername = useMemo(() => String(import.meta.env.VITE_BOT_USERNAME || ''), [])

  const walletAddress = useTonAddress(false)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [groups, setGroups] = useState([])
  const [earnings, setEarnings] = useState(null)
  const [withdrawing, setWithdrawing] = useState(false)

  const [profile, setProfile] = useState(null)
  const [walletSaveStatus, setWalletSaveStatus] = useState('idle') // idle|saving|saved|error
  const [walletSaveError, setWalletSaveError] = useState(null)

  const [toast, setToast] = useState(null)

  function truncateAddr(addr) {
    const a = String(addr || '').trim()
    if (!a) return '—'
    if (a.length <= 14) return a
    return `${a.slice(0, 6)}…${a.slice(-4)}`
  }

  useEffect(() => {
    if (!initData) return
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError(null)
        const [groupsResp, earningsResp, profileResp] = await Promise.all([
          fetch('/api/admin/groups/full', { method: 'GET', headers: { 'x-telegram-init-data': initData } }),
          fetch('/api/admin/earnings', { method: 'GET', headers: { 'x-telegram-init-data': initData } }),
          fetch('/api/admin/profile', { method: 'GET', headers: { 'x-telegram-init-data': initData } }),
        ])

        const groupsData = await groupsResp.json().catch(() => null)
        if (!groupsResp.ok) throw new Error(groupsData?.error || `Load failed (${groupsResp.status})`)

        const earningsData = await earningsResp.json().catch(() => null)
        if (earningsResp.ok) {
          if (!cancelled) setEarnings(earningsData || null)
        }

        const profileData = await profileResp.json().catch(() => null)
        if (profileResp.ok) {
          if (!cancelled) setProfile(profileData || null)
        }

        if (!cancelled) setGroups(Array.isArray(groupsData) ? groupsData : [])
      } catch (e) {
        if (!cancelled) setError(String(e?.message || e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [initData])

  async function refreshProfile() {
    const resp = await fetch('/api/admin/profile', {
      method: 'GET',
      headers: { 'x-telegram-init-data': initData },
    })
    const data = await resp.json().catch(() => null)
    if (!resp.ok) throw new Error(data?.error || `Load failed (${resp.status})`)
    setProfile(data || null)
  }

  async function refreshGroups() {
    const resp = await fetch('/api/admin/groups/full', {
      method: 'GET',
      headers: { 'x-telegram-init-data': initData },
    })
    const data = await resp.json().catch(() => null)
    if (!resp.ok) throw new Error(data?.error || `Load failed (${resp.status})`)
    setGroups(Array.isArray(data) ? data : [])
  }

  async function refreshEarnings() {
    const resp = await fetch('/api/admin/earnings', {
      method: 'GET',
      headers: { 'x-telegram-init-data': initData },
    })
    const data = await resp.json().catch(() => null)
    if (!resp.ok) throw new Error(data?.error || `Load failed (${resp.status})`)
    setEarnings(data || null)
  }

  async function withdraw() {
    try {
      setWithdrawing(true)
      const resp = await fetch('/api/admin/payout/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      })
      const data = await resp.json().catch(() => null)
      if (!resp.ok) throw new Error(data?.error || `Withdraw failed (${resp.status})`)
      setToast(`Withdrawal requested ✅ (${data.updated || 0} earnings)`)
      setTimeout(() => setToast(null), 2000)
      await refreshEarnings()
    } catch (e) {
      setToast(String(e?.message || e))
      setTimeout(() => setToast(null), 2500)
    } finally {
      setWithdrawing(false)
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text)
      setToast('Copied link ✅')
      setTimeout(() => setToast(null), 1500)
    } catch {
      setToast('Copy failed')
      setTimeout(() => setToast(null), 1500)
    }
  }

  async function saveWallet() {
    if (!initData) return
    if (!walletAddress) {
      setToast('Connect a wallet first')
      setTimeout(() => setToast(null), 1500)
      return
    }

    try {
      setWalletSaveStatus('saving')
      setWalletSaveError(null)

      const resp = await fetch('/api/admin/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, walletAddress }),
      })
      const data = await resp.json().catch(() => null)
      if (!resp.ok) throw new Error(data?.error || `Save failed (${resp.status})`)

      setWalletSaveStatus('saved')
      setToast('✅ Wallet saved and verified!')
      setTimeout(() => setToast(null), 2000)
      await refreshProfile()
    } catch (e) {
      setWalletSaveStatus('error')
      setWalletSaveError(String(e?.message || e))
      setToast(String(e?.message || e))
      setTimeout(() => setToast(null), 2500)
    }
  }

  return (
    <section className="card" style={{ display: 'grid', gap: 12 }}>
      <section className="card">
        <p className="sectionTitle">Wallet</p>
        <div className="row">
          <span className="label">Connected wallet</span>
          <span className="value">{walletAddress ? truncateAddr(walletAddress) : 'Not connected'}</span>
        </div>

        <div className="walletActions">
          <TonConnectButton />
        </div>

        {profile?.admin?.wallet_address ? (
          <div className="row" style={{ marginTop: 10 }}>
            <span className="label">Saved wallet</span>
            <span className="value" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="mono">{truncateAddr(profile.admin.wallet_address)}</span>
              {profile?.admin?.wallet_verified ? (
                <span className="chip status-success">
                  <span className="chipDot" />
                  ✅ Verified
                </span>
              ) : (
                <span className="chip status-pending">
                  <span className="chipDot" />
                  Pending
                </span>
              )}
            </span>
          </div>
        ) : (
          <p className="loading status-info" style={{ marginTop: 10 }}>
            No wallet saved yet. Connect a wallet and save it to receive payments.
          </p>
        )}

        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <button className="gradientBtn" onClick={saveWallet} disabled={!walletAddress || walletSaveStatus === 'saving'}>
            {walletSaveStatus === 'saving' ? 'Saving…' : 'Save Wallet'}
          </button>
          {walletSaveStatus !== 'idle' ? (
            <div className={`loading ${walletSaveStatus === 'saved' ? 'status-success' : walletSaveStatus === 'error' ? 'status-error' : 'status-pending'}`}>
              Save status: {walletSaveStatus}
              {walletSaveError ? ` • ${walletSaveError}` : ''}
            </div>
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="row" style={{ alignItems: 'center' }}>
          <div>
            <div className="label" style={{ fontSize: 16 }}>
              💰 Earnings
            </div>
            <div className="loading">Platform fees deducted automatically.</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <button className="payBtn" onClick={withdraw} disabled={withdrawing || !earnings || (earnings?.pending_balance || 0) <= 0}>
              {withdrawing ? 'Withdrawing…' : 'Withdraw'}
            </button>
          </div>
        </div>

        {earnings ? (
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            <div className="row">
              <span className="label">Total Earned</span>
              <span className="value">{earnings.total_earned} TON</span>
            </div>
            <div className="row">
              <span className="label">Pending Balance</span>
              <span className="value">{earnings.pending_balance} TON</span>
            </div>
            <div className="row">
              <span className="label">Paid Out</span>
              <span className="value">{earnings.total_paid_out} TON</span>
            </div>
          </div>
        ) : (
          <div className="loading" style={{ marginTop: 10 }}>
            Loading earnings…
          </div>
        )}
      </section>

      <section className="card">
      <div className="row" style={{ alignItems: 'center' }}>
        <div>
          <div className="label" style={{ fontSize: 16 }}>
            Your Premium Groups
          </div>
          <div className="loading">Groups are created via the bot onboarding flow. Use this dashboard to manage and share links.</div>
          <div className="loading" style={{ marginTop: 6 }}>
            To regenerate a subscriber's invite link, use the bot: <span className="mono">/regen_invite</span>
          </div>
        </div>
      </div>

      {toast ? <div className="loading" style={{ marginTop: 10 }}>{toast}</div> : null}

      {loading ? <p className="loading">Loading groups…</p> : null}
      {error ? <p className="loading">Error: {error}</p> : null}

      {!loading && !error && groups.length === 0 ? <p className="loading">No groups yet.</p> : null}

      {!loading && !error && groups.length ? (
        <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
          {groups.map((g) => {
            const link = buildBotDeepLink({ botUsername, groupName: g.name, groupId: g.id }) || ''
            return (
              <div key={g.id} className="card">
                <div className="row">
                  <span className="label">Name</span>
                  <span className="value">{g.name}</span>
                </div>
                <div className="row">
                  <span className="label">Price</span>
                  <span className="value">{g.price_ton} TON</span>
                </div>
                <div className="row">
                  <span className="label">Duration</span>
                  <span className="value">{g.duration_days} days</span>
                </div>
                <div className="row">
                  <span className="label">Members</span>
                  <span className="value">{g.member_count}</span>
                </div>
                <div className="row">
                  <span className="label">Link</span>
                  <span className="value mono" style={{ overflowWrap: 'anywhere' }}>
                    {link}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button
                    className="payBtn"
                    onClick={() => {
                      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}`
                      const openTg = window.Telegram?.WebApp?.openTelegramLink
                      if (typeof openTg === 'function') openTg(shareUrl)
                      else window.open(shareUrl, '_blank', 'noopener,noreferrer')
                    }}
                    disabled={!link}
                  >
                    📤 Share
                  </button>
                  <button className="payBtn" onClick={() => copy(link)} disabled={!link}>
                    📋 Copy Bot Link
                  </button>
                </div>
                <div className="loading" style={{ marginTop: 8 }}>
                  Share this link with potential subscribers. They'll be guided through payment by the bot.
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      </section>
    </section>
  )
}

export default AdminDashboard
