$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root 'bin'
$exe = Join-Path $bin 'cloudflared.exe'

New-Item -ItemType Directory -Force -Path $bin | Out-Null

if (Test-Path $exe) {
  Write-Host "cloudflared already exists: $exe"
  exit 0
}

$url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
Write-Host "Downloading cloudflared from: $url"

Invoke-WebRequest -Uri $url -OutFile $exe

Write-Host "Installed cloudflared: $exe"

