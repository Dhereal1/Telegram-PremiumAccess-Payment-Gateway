import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPool } from './index.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `)
}

async function getApplied(pool) {
  const r = await pool.query('SELECT id FROM schema_migrations')
  return new Set(r.rows.map((x) => x.id))
}

export async function migrate() {
  const pool = getPool()
  await ensureMigrationsTable(pool)
  const applied = await getApplied(pool)

  const dir = path.join(__dirname, 'migrations')
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await fs.readFile(path.join(dir, file), 'utf8')
    await pool.query('BEGIN')
    try {
      await pool.query(sql)
      await pool.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file])
      await pool.query('COMMIT')
      // eslint-disable-next-line no-console
      console.log(`applied ${file}`)
    } catch (e) {
      await pool.query('ROLLBACK')
      throw e
    }
  }
}

// Run when invoked directly: `node db/migrate.mjs`
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
const thisPath = path.resolve(fileURLToPath(import.meta.url))
if (invokedPath && invokedPath === thisPath) {
  migrate()
    .then(() => process.exit(0))
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e)
      process.exit(1)
    })
}
