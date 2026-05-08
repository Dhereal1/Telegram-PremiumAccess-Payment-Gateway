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

  const [modalOpen, setModalOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState(null)

  const [form, setForm] = useState({
    name: '',
    telegram_chat_id: '',
    price_ton: '0.01',
    duration_days: '30',
  })

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

  async function submitCreate() {
    try {
      setCreating(true)
      setToast(null)
      const payload = {
        initData,
        telegram_chat_id: form.telegram_chat_id.trim(),
        name: form.name.trim(),
        price_ton: Number(form.price_ton),
        duration_days: Number(form.duration_days),
      }

      const resp = await fetch('/api/admin/groups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await resp.json().catch(() => null)
      if (!resp.ok) throw new Error(data?.reason ? `${data.error}: ${data.reason}` : data?.error || `Create failed (${resp.status})`)

      setToast('Group created ✅')
      setTimeout(() => setToast(null), 2000)
      setModalOpen(false)
      setForm({ name: '', telegram_chat_id: '', price_ton: '0.01', duration_days: '30' })
      await refreshGroups()
    } catch (e) {
      setToast(String(e?.message || e))
      setTimeout(() => setToast(null), 2500)
    } finally {
      setCreating(false)
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
          <div className="loading">Manage groups, pricing, and share links.</div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button className="payBtn" onClick={() => setModalOpen(true)}>
            Create New Group
          </button>
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

      {modalOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 50,
          }}
          onClick={() => (creating ? null : setModalOpen(false))}
        >
          <div className="card" style={{ width: '100%', maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <span className="label" style={{ fontSize: 16 }}>
                Create Group
              </span>
              <span style={{ marginLeft: 'auto' }}>
                <button className="payBtn" onClick={() => setModalOpen(false)} disabled={creating}>
                  Close
                </button>
              </span>
            </div>

            <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
              <label className="loading">
                Group Name
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 10, border: '1px solid #333', background: '#111', color: '#fff' }}
                />
              </label>

              <label className="loading">
                Telegram Chat ID
                <input
                  value={form.telegram_chat_id}
                  onChange={(e) => setForm((f) => ({ ...f, telegram_chat_id: e.target.value }))}
                  placeholder="-100xxxxxxxxxx"
                  style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 10, border: '1px solid #333', background: '#111', color: '#fff' }}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label className="loading">
                  Price (TON)
                  <input
                    value={form.price_ton}
                    onChange={(e) => setForm((f) => ({ ...f, price_ton: e.target.value }))}
                    style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 10, border: '1px solid #333', background: '#111', color: '#fff' }}
                  />
                </label>
                <label className="loading">
                  Duration (days)
                  <input
                    value={form.duration_days}
                    onChange={(e) => setForm((f) => ({ ...f, duration_days: e.target.value }))}
                    style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 10, border: '1px solid #333', background: '#111', color: '#fff' }}
                  />
                </label>
              </div>

              <button
                className="payBtn"
                onClick={submitCreate}
                disabled={creating || !form.name.trim() || !form.telegram_chat_id.trim()}
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </section>
    </section>
  )
}

export default AdminDashboard
