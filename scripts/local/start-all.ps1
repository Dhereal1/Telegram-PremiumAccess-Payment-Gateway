Param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Continue"
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$AppDir = Join-Path $RepoRoot "telegram-mini-app"

Write-Host "[start-all] RepoRoot: $RepoRoot"
Write-Host "[start-all] AppDir:   $AppDir"

Set-Location $AppDir

if (!(Test-Path ".env")) {
  throw "Missing telegram-mini-app/.env (create it and add values)."
}

Write-Host "[start-all] Installing deps (if needed)..."
npm install | Out-Null

function Start-Pm2Process($Name, $ScriptPath) {
  # Avoid parsing `pm2 jlist` JSON in Windows PowerShell (it can fail due to duplicate keys / extra output).
  npx pm2 show $Name *> $null
  $exists = ($LASTEXITCODE -eq 0)

  if ($exists) {
    Write-Host "[start-all] pm2 restart $Name"
    npx pm2 restart $Name --update-env | Out-Null
  } else {
    Write-Host "[start-all] pm2 start $Name -> $ScriptPath"
    npx pm2 start node --name $Name -- $ScriptPath | Out-Null
  }
}

Write-Host "[start-all] Starting local web server (Vite+API) on port $Port ..."
npx pm2 show local-web *> $null
$webExists = ($LASTEXITCODE -eq 0)
if ($webExists) {
  npx pm2 restart local-web --update-env | Out-Null
} else {
  npx pm2 start node --name local-web -- "server/local-dev.mjs" | Out-Null
}

Write-Host "[start-all] Starting workers..."
Start-Pm2Process "verify-payments" "workers/processors/verifyPaymentWorker.mjs"
Start-Pm2Process "grant-access" "workers/processors/grantAccessWorker.mjs"
Start-Pm2Process "expiry" "workers/processors/expiryWorker.mjs"

$tonListenerPath = "workers/listeners/tonListener.mjs"
if (Test-Path $tonListenerPath) {
  Start-Pm2Process "ton-listener" $tonListenerPath
} else {
  Write-Host "[start-all] Skipping ton-listener (missing $tonListenerPath)"
}

$expirySchedulerPath = "workers/listeners/expiryScheduler.mjs"
if (Test-Path $expirySchedulerPath) {
  Start-Pm2Process "expiry-scheduler" $expirySchedulerPath
} else {
  Write-Host "[start-all] Skipping expiry-scheduler (missing $expirySchedulerPath)"
}

Write-Host "[start-all] Starting Cloudflare tunnel..."
if (!(Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  throw "cloudflared not found. Install it, then re-run: winget install Cloudflare.cloudflared"
}

$tunnelLog = Join-Path $env:TEMP "cloudflared-tunnel.log"
Remove-Item -Force $tunnelLog -ErrorAction SilentlyContinue | Out-Null

$cf = Start-Process -FilePath "cloudflared" -ArgumentList @("tunnel","--url","http://localhost:$Port","--no-autoupdate") -NoNewWindow -PassThru -RedirectStandardOutput $tunnelLog -RedirectStandardError $tunnelLog

Write-Host "[start-all] Waiting for tunnel URL..."
$tunnelUrl = $null
for ($i=0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-Path $tunnelLog) {
    $txt = Get-Content $tunnelLog -Raw
    $m = [regex]::Match($txt, 'https://[a-z0-9\\-]+\\.trycloudflare\\.com')
    if ($m.Success) { $tunnelUrl = $m.Value; break }
  }
}

if (-not $tunnelUrl) {
  Write-Host "[start-all] cloudflared output:"
  if (Test-Path $tunnelLog) { Get-Content $tunnelLog -Tail 80 }
  throw "Could not detect Cloudflare tunnel URL."
}

Write-Host "[start-all] Tunnel URL: $tunnelUrl"

Write-Host "[start-all] Starting bot in polling mode with WEB_APP_URL=$tunnelUrl ..."
$env:WEB_APP_URL = "$tunnelUrl/"

Start-Pm2Process "local-bot" "server/local-bot.mjs"

Write-Host ""
Write-Host "[start-all] DONE"
Write-Host "  - Open Mini App URL: $tunnelUrl"
Write-Host "  - Bot uses WEB_APP_URL=$($env:WEB_APP_URL)"
Write-Host ""
Write-Host "Useful:"
Write-Host "  npx pm2 list"
Write-Host "  npx pm2 logs local-web --lines 50"
Write-Host "  npx pm2 logs local-bot --lines 50"
Write-Host "  npx pm2 logs ton-listener --lines 50"
