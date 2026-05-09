param(
  [string]$EnvPath,
  [string]$CloudflaredLogPath,
  [string]$ProcessWeb,
  [string]$ProcessBot,
  [switch]$UpdateTelegramWebhook
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $here "..\\..") | Select-Object -ExpandProperty Path
if (-not $EnvPath) { $EnvPath = Join-Path $projectRoot ".env" }
if (-not $CloudflaredLogPath) { $CloudflaredLogPath = Join-Path $projectRoot "bin\\cloudflared.log" }
if (-not $ProcessWeb) { $ProcessWeb = "local-web" }
if (-not $ProcessBot) { $ProcessBot = "local-bot" }

function Get-CloudflarePublicUrl([string]$logPath) {
  if (-not (Test-Path $logPath)) {
    throw "Missing cloudflared log file: $logPath. Is the cloudflared PM2 process running?"
  }

  # Use -Raw + regex to avoid edge cases with Select-String on some Windows setups.
  $content = Get-Content $logPath -Raw
  # Use character classes for dots to avoid escaping pitfalls across shells.
  $pattern = "https://[a-z0-9-]+[.]trycloudflare[.]com"
  $matches = [regex]::Matches($content, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if (-not $matches -or $matches.Count -eq 0) {
    throw "No trycloudflare URL found in $logPath yet. Wait a few seconds and retry."
  }
  $url = [string]$matches[$matches.Count - 1].Value
  if (-not $url.EndsWith("/")) { $url = $url + "/" }
  return $url
}

function Set-DotEnvKeyValue([string]$path, [string]$key, [string]$value) {
  if (-not (Test-Path $path)) { throw "Missing env file: $path" }
  $content = Get-Content $path
  $line = "$key=$value"
  $pattern = ("^" + [regex]::Escape($key) + "=.*$")
  if ($content | Where-Object { $_ -match $pattern }) {
    $content = $content -replace $pattern, $line
  } else {
    $content += $line
  }
  Set-Content -Path $path -Value $content
}

$publicUrl = Get-CloudflarePublicUrl $CloudflaredLogPath
Write-Host "cloudflared public URL: $publicUrl"

Set-DotEnvKeyValue -path $EnvPath -key "WEB_APP_URL" -value $publicUrl
Write-Host "Updated WEB_APP_URL in $EnvPath"

$pm2 = Join-Path $projectRoot "node_modules\\.bin\\pm2.cmd"
if (-not (Test-Path $pm2)) {
  throw "pm2 not found at $pm2. Run: npm install"
}

Write-Host "Restarting PM2 processes: $ProcessWeb, $ProcessBot"
& $pm2 restart $ProcessWeb --update-env | Out-Null
& $pm2 restart $ProcessBot --update-env | Out-Null

if ($UpdateTelegramWebhook) {
  $envText = Get-Content $EnvPath
  $botToken = ($envText | Where-Object { $_ -match '^BOT_TOKEN=' } | Select-Object -First 1) -replace '^BOT_TOKEN=', ''
  if (-not $botToken) { throw "BOT_TOKEN missing in .env; can't update webhook." }

  $mode = ($envText | Where-Object { $_ -match '^TELEGRAM_UPDATE_MODE=' } | Select-Object -First 1) -replace '^TELEGRAM_UPDATE_MODE=', ''
  if (-not $mode) { $mode = "polling" }
  $mode = $mode.Trim().ToLowerInvariant()

  if ($mode -eq "webhook") {
    $webhookUrl = ($publicUrl.TrimEnd('/')) + "/api/telegram/webhook"
    Write-Host "Updating Telegram webhook to: $webhookUrl"

    $secret = ($envText | Where-Object { $_ -match '^TELEGRAM_WEBHOOK_SECRET=' } | Select-Object -First 1) -replace '^TELEGRAM_WEBHOOK_SECRET=', ''
    $payload = @{ url = $webhookUrl }
    if ($secret) { $payload.secret_token = $secret }

    $body = $payload | ConvertTo-Json -Compress
    $resp = Invoke-RestMethod -Method Post -Uri ("https://api.telegram.org/bot$botToken/setWebhook") -ContentType "application/json" -Body $body
    Write-Host ("setWebhook ok=" + $resp.ok)
  } else {
    Write-Host "TELEGRAM_UPDATE_MODE=$mode; deleting webhook to allow polling."
    $resp = Invoke-RestMethod -Method Post -Uri ("https://api.telegram.org/bot$botToken/deleteWebhook?drop_pending_updates=true")
    Write-Host ("deleteWebhook ok=" + $resp.ok)
  }
}

Write-Host "Done."
