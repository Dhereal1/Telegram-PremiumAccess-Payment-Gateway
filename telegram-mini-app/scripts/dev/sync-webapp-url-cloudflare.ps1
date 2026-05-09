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
  $pattern = "https://[a-z0-9-]+\\.trycloudflare\\.com"
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

  $pattern = "^$([regex]::Escape($key))="
  $hasKey = $content | Where-Object { $_ -match $pattern } | Select-Object -First 1

  if ($hasKey) {
    $content = $content -replace $pattern + ".*$", "$key=$value"
  } else {
    $content += "$key=$value"
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

  $webhookUrl = ($publicUrl.TrimEnd('/')) + "/api/telegram/webhook"
  Write-Host "Updating Telegram webhook to: $webhookUrl"

  $body = @{ url = $webhookUrl } | ConvertTo-Json -Compress
  $resp = Invoke-RestMethod -Method Post -Uri ("https://api.telegram.org/bot$botToken/setWebhook") -ContentType "application/json" -Body $body
  Write-Host ("setWebhook ok=" + $resp.ok)
}

Write-Host "Done."
