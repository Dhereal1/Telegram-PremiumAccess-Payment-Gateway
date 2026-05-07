import express from 'express'
import { createServer as createViteServer } from 'vite'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import apiHandler from '../api/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

const port = Number(process.env.PORT || '3000')

async function main() {
  const app = express()

  // JSON body parsing for our API handlers (they still fall back to stream parsing when needed).
  app.use(express.json({ limit: '2mb' }))

  // Mount the existing Vercel-style API router under /api.
  // Express strips the mount path from req.url, which is fine because our router
  // dispatches on the path portion after /api.
  app.use('/api', (req, res) => apiHandler(req, res))

  // Vite dev server in middleware mode so / and assets are served from source with HMR.
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom',
  })
  app.use(vite.middlewares)

  app.listen(port, () => {
    console.log(`[local-dev] running on http://localhost:${port}`)
  })
}

main().catch((e) => {
  console.error('[local-dev] failed to start', e)
  process.exit(1)
})
