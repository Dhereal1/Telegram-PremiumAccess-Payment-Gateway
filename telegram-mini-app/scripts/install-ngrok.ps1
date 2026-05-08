$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root 'bin'
$exe = Join-Path $bin 'ngrok.exe'
$zip = Join-Path $bin 'ngrok.zip'

New-Item -ItemType Directory -Force -Path $bin | Out-Null

if (Test-Path $exe) {
  Write-Host "ngrok already exists: $exe"
  exit 0
}

$urls = @(
  # Primary (official download CDN)
  "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip",
  # Fallback (GitHub release mirror) - more likely to resolve on restrictive DNS
  "https://github.com/ngrok/ngrok/releases/latest/download/ngrok-v3-stable-windows-amd64.zip"
)

$downloaded = $false
foreach ($url in $urls) {
  try {
    Write-Host "Downloading ngrok from: $url"
    Invoke-WebRequest -Uri $url -OutFile $zip
    $downloaded = $true
    break
  } catch {
    Write-Warning "Failed to download from: $url"
  }
}

if (-not $downloaded) {
  throw "Failed to download ngrok from all sources (DNS/network issue)."
}

Write-Host "Extracting ngrok..."
Expand-Archive -Path $zip -DestinationPath $bin -Force

Remove-Item -Force $zip

if (-not (Test-Path $exe)) {
  throw "ngrok.exe not found after extract at $exe"
}

Write-Host "Installed ngrok: $exe"
