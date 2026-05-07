$ErrorActionPreference = "Stop"

if (-not $env:RUN_WORKERS_URL) { throw "Missing RUN_WORKERS_URL env var" }
if (-not $env:CRON_SECRET) { throw "Missing CRON_SECRET env var" }

$sleepSeconds = 60
if ($env:RUN_WORKERS_INTERVAL_SECONDS) {
  $parsed = 0
  if ([int]::TryParse($env:RUN_WORKERS_INTERVAL_SECONDS, [ref]$parsed) -and $parsed -gt 0) {
    $sleepSeconds = $parsed
  }
}

Write-Host "RUN_WORKERS_URL=$($env:RUN_WORKERS_URL)"
Write-Host "IntervalSeconds=$sleepSeconds"
Write-Host "Press Ctrl+C to stop."

while ($true) {
  $ts = Get-Date -Format o
  try {
    $resp = Invoke-RestMethod -Method Post `
      -Uri $env:RUN_WORKERS_URL `
      -Headers @{ "x-cron-secret" = $env:CRON_SECRET } `
      -ContentType "application/json" `
      -Body "{}"

    if ($resp.skipped -eq $true) {
      Write-Host "[$ts] SKIP reason=$($resp.reason)"
    } else {
      Write-Host "[$ts] OK elapsedMs=$($resp.elapsedMs) ton.enqueued=$($resp.ton.enqueued) verify.processed=$($resp.verify.processed) access.processed=$($resp.access.processed) expiry.processed=$($resp.expiry.processed)"
    }
  } catch {
    Write-Host "[$ts] FAIL $($_.Exception.Message)"
  }

  Start-Sleep -Seconds $sleepSeconds
}

