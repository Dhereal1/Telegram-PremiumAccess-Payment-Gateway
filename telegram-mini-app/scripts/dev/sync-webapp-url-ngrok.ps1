param(
  [string]$EnvPath,
  [string]$NgrokApi,
  [string]$ProcessWeb,
  [string]$ProcessBot
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $EnvPath) { $EnvPath = Join-Path $here "..\\..\\.env" }
if (-not $NgrokApi) { $NgrokApi = "http://127.0.0.1:4040/api/tunnels" }
if (-not $ProcessWeb) { $ProcessWeb = "local-web" }
if (-not $ProcessBot) { $ProcessBot = "local-bot" }

function Get-NgrokPublicUrl {
  try {
    $resp = Invoke-RestMethod -Method Get -Uri $NgrokApi -TimeoutSec 5
  } catch {
    throw "Unable to reach ngrok API at $NgrokApi. Is ngrok running?"
  }

  $tunnels = @($resp.tunnels)
  if (-not $tunnels -or $tunnels.Count -eq 0) {
    throw "No tunnels returned from ngrok API."
  }

  $https = $tunnels | Where-Object { $_.public_url -like "https://*" } | Select-Object -First 1
  if (-not $https) {
    throw "No https tunnel found in ngrok API response."
  }

  $url = [string]$https.public_url
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

$publicUrl = Get-NgrokPublicUrl
Write-Host "ngrok public URL: $publicUrl"

Set-DotEnvKeyValue -path $EnvPath -key "WEB_APP_URL" -value $publicUrl
Write-Host "Updated WEB_APP_URL in $EnvPath"

Write-Host "Restarting PM2 processes: $ProcessWeb, $ProcessBot"
& npx --yes pm2 restart $ProcessWeb --update-env | Out-Null
& npx --yes pm2 restart $ProcessBot --update-env | Out-Null

Write-Host "Done."
