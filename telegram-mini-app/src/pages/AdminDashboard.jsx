import { useEffect, useMemo, useState } from 'react'

function buildGroupLink({ origin, groupId }) {
  const url = new URL(origin)
  url.searchParams.set('g', String(groupId))
  return url.toString()
}

function AdminDashboard({ tg }) {
  const initData = tg?.initData || ''
  const origin = useMemo(() => window.location.origin + '/', [])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [groups, setGroups] = useState([])
  const [earnings, setEarnings] = useState(null)
  const [withdrawing, setWithdrawing] = useState(false)

  const [toast, setToast] = useState(null)

  useEffect(() => {
    if (!initData) return
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError(null)
        const [groupsResp, earningsResp] = await Promise.all([
          fetch('/api/admin/groups/full', { method: 'GET', headers: { 'x-telegram-init-data': initData } }),
          fetch('/api/admin/earnings', { method: 'GET', headers: { 'x-telegram-init-data': initData } }),
        ])

        const groupsData = await groupsResp.json().catch(() => null)
        if (!groupsResp.ok) throw new Error(groupsData?.error || `Load failed (${groupsResp.status})`)

        const earningsData = await earningsResp.json().catch(() => null)
        if (earningsResp.ok) {
          if (!cancelled) setEarnings(earningsData || null)
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

  return (
    <section className="card" style={{ display: 'grid', gap: 12 }}>
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
        </div>
      </div>

      {toast ? <div className="loading" style={{ marginTop: 10 }}>{toast}</div> : null}

      {loading ? <p className="loading">Loading groups…</p> : null}
      {error ? <p className="loading">Error: {error}</p> : null}

      {!loading && !error && groups.length === 0 ? <p className="loading">No groups yet.</p> : null}

      {!loading && !error && groups.length ? (
        <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
          {groups.map((g) => {
            const link = buildGroupLink({ origin, groupId: g.id })
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
                  <button className="payBtn" onClick={() => window.open(link, '_blank', 'noopener,noreferrer')}>
                    Open Link
                  </button>
                  <button className="payBtn" onClick={() => copy(link)}>
                    Copy Link
                  </button>
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
