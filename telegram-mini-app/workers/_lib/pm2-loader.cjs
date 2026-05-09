// CJS wrapper for PM2 on Windows: load `.env` first, then spawn the ESM entry.
// Usage: node workers/_lib/pm2-loader.cjs <entry.mjs>

const path = require('path');
const { spawn } = require('child_process');
const dns = require('dns');

// Always load the repo-local env file for workers.
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Reduce intermittent Windows/ISP DNS flakiness (IPv6 AAAA first) for Redis/Neon/TonCenter.
// Node >= 17 supports this API.
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

// Optional override to use known-stable resolvers on flaky networks.
// Example: DNS_SERVERS=1.1.1.1,8.8.8.8
try {
  if (process.env.DNS_SERVERS) {
    const servers = String(process.env.DNS_SERVERS)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (servers.length) dns.setServers(servers);
  }
} catch {}

const script = process.argv[2];
if (!script) {
  console.error('Usage: node workers/_lib/pm2-loader.cjs <entry.mjs>');
  process.exit(2);
}

const child = spawn(process.execPath, [script], {
  env: process.env,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
