$ErrorActionPreference = "Stop"

if (-not $env:RUN_WORKERS_URL) { throw "Missing RUN_WORKERS_URL env var" }
if (-not $env:CRON_SECRET) { throw "Missing CRON_SECRET env var" }

Invoke-RestMethod -Method Post `
  -Uri $env:RUN_WORKERS_URL `
  -Headers @{ "x-cron-secret" = $env:CRON_SECRET } `
  -ContentType "application/json" `
  -Body "{}"

