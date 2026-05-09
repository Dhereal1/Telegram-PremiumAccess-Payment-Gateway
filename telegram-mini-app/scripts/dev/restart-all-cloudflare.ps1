$ErrorActionPreference = "Stop"

function Get-ProjectRoot {
  $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  return (Resolve-Path (Join-Path $here "..\\..")).Path
}

function Read-TryCloudflareUrl {
  param(
    [Parameter(Mandatory=$true)][string]$LogPath,
    [int]$TimeoutSeconds = 60
  )

  $pattern = "https://[a-z0-9-]+[.]trycloudflare[.]com"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    if (Test-Path $LogPath) {
      $content = Get-Content $LogPath -Raw -ErrorAction SilentlyContinue
      if ($content) {
        $m = [regex]::Matches($content, $pattern) | Select-Object -Last 1
        if ($m -and $m.Value) {
          return ($m.Value.TrimEnd("/") + "/")
        }
      }
    }
    Start-Sleep -Seconds 2
  }

  throw "Timed out waiting for trycloudflare URL in $LogPath"
}

$root = Get-ProjectRoot
Set-Location $root

# Ensure cloudflared.exe exists.
& powershell -ExecutionPolicy Bypass -File (Join-Path $root "scripts\\install-cloudflared.ps1") | Out-Null

# Hard reset: stop any stale processes (prevents confusing old logs).
& npx pm2 delete all | Out-Null

# Start everything (cloudflared + local-web + local-bot + workers).
& npx pm2 start ecosystem.config.cjs | Out-Null

# Wait for public URL, then update WEB_APP_URL and restart app/bot with updated env.
$logPath = Join-Path $root "bin\\cloudflared.log"
$publicUrl = Read-TryCloudflareUrl -LogPath $logPath -TimeoutSeconds 90
Write-Host "cloudflared public URL: $publicUrl"

# For local stability, prefer webhook mode (avoids long-poll conflicts when multiple instances exist).
$envPath = Join-Path $root ".env"
if (Test-Path $envPath) {
  $envLines = Get-Content $envPath
  $hasMode = $false
  $envLines = $envLines | ForEach-Object {
    if ($_ -match '^TELEGRAM_UPDATE_MODE=') { $hasMode = $true; 'TELEGRAM_UPDATE_MODE=webhook' } else { $_ }
  }
  if (-not $hasMode) { $envLines += 'TELEGRAM_UPDATE_MODE=webhook' }
  Set-Content -Path $envPath -Value $envLines
}

# Sync WEB_APP_URL in .env + restart local-web/local-bot + set webhook to the new public URL.
& powershell -ExecutionPolicy Bypass -File (Join-Path $root "scripts\\dev\\sync-webapp-url-cloudflare.ps1") -CloudflaredLogPath $logPath -UpdateTelegramWebhook | Out-Null

Write-Host ""
Write-Host "OK. Processes:"
& npx pm2 list
