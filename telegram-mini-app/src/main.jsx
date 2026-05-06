import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { Buffer } from 'buffer'
import process from 'process'

// Polyfills for TON libs in Telegram webviews
if (!globalThis.Buffer) globalThis.Buffer = Buffer
if (!globalThis.process) globalThis.process = process

function renderFatal(message) {
  const root = document.getElementById('root')
  if (!root) return
  const escaped = String(message)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
  root.innerHTML = `<div style="padding:16px;font-family:system-ui;color:#fff;background:#0f0f10;white-space:pre-wrap">Mini App failed to start:\n${escaped}</div>`
}

window.addEventListener('error', (e) => {
  renderFatal(e?.error?.message || e?.message || 'Unknown error')
})
window.addEventListener('unhandledrejection', (e) => {
  renderFatal(e?.reason?.message || String(e?.reason || 'Unhandled rejection'))
})

async function boot() {
  try {
    const { TonConnectUIProvider } = await import('@tonconnect/ui-react')
    const manifestUrl = new URL('/api/tonconnect/manifest', window.location.href).toString()

    createRoot(document.getElementById('root')).render(
      <StrictMode>
        <TonConnectUIProvider manifestUrl={manifestUrl}>
          <App />
        </TonConnectUIProvider>
      </StrictMode>,
    )
  } catch (e) {
    renderFatal(e?.message || String(e))
  }
}

boot()
