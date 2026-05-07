# Copy to `scripts/local/set-env.ps1` (gitignored) and fill values.
# Then run: `. .\\scripts\\local\\set-env.ps1`

$env:RUN_WORKERS_URL = "https://<YOUR_VERCEL_DOMAIN>/api/internal/run-workers"
$env:CRON_SECRET = "<YOUR_CRON_SECRET>"

# Optional
$env:RUN_WORKERS_INTERVAL_SECONDS = "60"

