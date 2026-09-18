$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "Repairing Jazz runtime from origin/main..." -ForegroundColor Cyan

# Keep private/local config untouched. Only runtime source/generated dependencies are refreshed.
$runtimeFiles = @(
  "services/api/src/server.mjs",
  "services/api/src/ollama.mjs",
  "services/api/src/tts.mjs",
  "services/api/src/device-bridge.mjs",
  "services/api/src/android-intents.mjs",
  "services/api/src/script-registry.mjs",
  "bridges/windows-adb/adb-bridge.mjs",
  "tools/piper/setup-windows.ps1",
  "apps/web/package.json",
  "apps/web/vite.config.ts",
  "apps/web/index.html",
  "apps/web/public/api-runtime.js",
  "apps/web/public/favicon.svg",
  "apps/web/src/api-runtime.ts",
  "apps/web/src/main.tsx",
  "apps/web/src/voice.ts",
  "apps/web/src/voice-orb.css",
  "apps/web/src/voice-orb-stage.ts",
  "start-jazz.ps1"
)

git fetch origin main
if ($LASTEXITCODE -ne 0) { throw "git fetch origin main failed." }

git checkout origin/main -- $runtimeFiles
if ($LASTEXITCODE -ne 0) { throw "Could not refresh Jazz runtime files from origin/main." }

$server = Get-Content ".\services\api\src\server.mjs" -Raw
if ($server -notmatch 'const VERSION = "0\.10\.0-local"') {
  throw "Repair failed: expected Jazz API 0.10.0-local was not found."
}
if ($server -match 'I tried the configured model and resilient fallbacks') {
  throw "Repair failed: legacy Gemini fallback text still exists."
}

$apiRuntime = Get-Content ".\apps\web\public\api-runtime.js" -Raw
if ($apiRuntime -notmatch '127\.0\.0\.1:8797') {
  throw "Repair failed: web runtime is not pinned to Jazz API port 8797."
}

$vite = Get-Content ".\apps\web\vite.config.ts" -Raw
if ($vite -notmatch 'dedupe: \["react", "react-dom"\]') {
  throw "Repair failed: React dedupe configuration is missing."
}

# The invalid-hook-call error is caused by multiple/stale React copies in the web
# dependency tree. node_modules is generated, so rebuild only the web workspace.
Write-Host "Rebuilding Jazz web dependencies to guarantee one React runtime..." -ForegroundColor Cyan
$webNodeModules = Join-Path $root "apps\web\node_modules"
if (Test-Path $webNodeModules) {
  Remove-Item $webNodeModules -Recurse -Force -ErrorAction Stop
}
Remove-Item (Join-Path $root "node_modules\.vite") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root "node_modules\.vite-jazz") -Recurse -Force -ErrorAction SilentlyContinue

$pnpm = Get-Command pnpm -ErrorAction Stop
& $pnpm.Source install --filter "@jazz/web" --force
if ($LASTEXITCODE -ne 0) { throw "pnpm failed while rebuilding Jazz web dependencies." }

Write-Host "Runtime source repaired successfully." -ForegroundColor Green
Write-Host "React web dependencies rebuilt cleanly." -ForegroundColor Green
Write-Host "Private .env files were not changed." -ForegroundColor DarkGray
Write-Host "Starting Jazz..." -ForegroundColor Cyan

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\start-jazz.ps1"
