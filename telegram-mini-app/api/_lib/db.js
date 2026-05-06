const { Pool } = require('pg');

let pool;

function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) {
    throw new Error('Missing DATABASE_URL env var');
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });

  return pool;
}

module.exports = { getPool };

