module.exports = {
  apps: [
    {
      // Public HTTPS tunnel for local dev. Prefer ngrok for stability on spotty DNS.
      // Install via: scripts/install-ngrok.ps1
      name: 'ngrok',
      script: 'bin/ngrok.exe',
      // ngrok requires an authtoken (free). Set NGROK_AUTHTOKEN in .env and run:
      //   bin/ngrok.exe config add-authtoken %NGROK_AUTHTOKEN%
      args: 'http http://localhost:3000 --log=stdout',
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
