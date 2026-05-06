import { useEffect, useState } from 'react'
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

  const receiverAddress = import.meta.env.VITE_TON_RECEIVER_ADDRESS || 'UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ'
  const tonPriceTon = Number(import.meta.env.VITE_TON_PRICE_TON || '0.1')

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

      const telegramId = String(user?.id ?? tg?.initDataUnsafe?.user?.id ?? '')
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

        <button className="payBtn" onClick={handlePayment} disabled={!walletAddress || payStatus === 'sending'}>
          {payStatus === 'sending' ? 'Sending…' : `Pay ${tonPriceTon} TON`}
        </button>

        <p className="loading">
          Receiver: <span className="mono">{receiverAddress}</span>
        </p>
        {payError ? <p className="loading">Error: {payError}</p> : null}
        {payStatus === 'sent' ? <p className="loading">Payment request sent. Waiting for confirmation…</p> : null}
      </section>
    </>
  )
}

export default TonSection

