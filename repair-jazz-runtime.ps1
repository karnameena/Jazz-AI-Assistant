$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "Repairing Jazz runtime from origin/main..." -ForegroundColor Cyan

# Keep private/local config untouched. Only runtime source files are refreshed.
$runtimeFiles = @(
  "services/api/src/server.mjs",
  "services/api/src/ollama.mjs",
  "services/api/src/tts.mjs",
  "services/api/src/device-bridge.mjs",
  "services/api/src/android-intents.mjs",
  "services/api/src/script-registry.mjs",
  "bridges/windows-adb/adb-bridge.mjs",
  "apps/web/vite.config.ts",
  "apps/web/index.html",
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

$apiRuntime = Get-Content ".\apps\web\src\api-runtime.ts" -Raw
if ($apiRuntime -notmatch '127\.0\.0\.1:8797') {
  throw "Repair failed: web runtime is not pinned to Jazz API port 8797."
}

Write-Host "Runtime source repaired successfully." -ForegroundColor Green
Write-Host "Private .env files were not changed." -ForegroundColor DarkGray
Write-Host "Starting Jazz..." -ForegroundColor Cyan

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\start-jazz.ps1"
