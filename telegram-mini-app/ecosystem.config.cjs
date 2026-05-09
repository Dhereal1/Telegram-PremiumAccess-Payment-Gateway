module.exports = {
  apps: [
    {
      // Public HTTPS tunnel for local dev.
      // Install via: scripts/install-cloudflared.ps1
      name: 'cloudflared',
      script: 'bin/cloudflared.exe',
      // Account-less quick tunnels rotate URLs on restart; scripts/dev/sync-webapp-url-cloudflare.ps1
      // updates WEB_APP_URL automatically from the log file.
      args: 'tunnel --no-autoupdate --url http://localhost:3000 --loglevel info --logfile bin/cloudflared.log',
      exec_interpreter: 'none',
      cwd: __dirname,
    },
    {
      name: 'local-web',
      script: 'server/local-dev.mjs',
      interpreter: 'node',
      cwd: __dirname,
    },
    {
      name: 'local-bot',
      script: 'server/local-bot.mjs',
      interpreter: 'node',
      cwd: __dirname,
    },
    {
      name: 'verify-payments',
      script: 'workers/_lib/pm2-loader.cjs',
      args: 'workers/processors/verifyPaymentWorker.mjs',
      interpreter: 'node',
      cwd: __dirname,
    },
    {
      name: 'grant-access',
      script: 'workers/_lib/pm2-loader.cjs',
      args: 'workers/processors/grantAccessWorker.mjs',
      interpreter: 'node',
      cwd: __dirname,
    },
    {
      name: 'expiry',
      script: 'workers/_lib/pm2-loader.cjs',
      args: 'workers/processors/expiryWorker.mjs',
      interpreter: 'node',
      cwd: __dirname,
    },
    {
      name: 'ton-listener',
      script: 'workers/_lib/pm2-loader.cjs',
      args: 'workers/listeners/tonListener.mjs',
      interpreter: 'node',
      cwd: __dirname,
    },
    {
      name: 'expiry-scheduler',
      script: 'workers/_lib/pm2-loader.cjs',
      args: 'workers/listeners/expiryScheduler.mjs',
      interpreter: 'node',
      cwd: __dirname,
    },
  ],
};
