$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "Repairing Jazz Android control workflow from origin/main..." -ForegroundColor Cyan

$files = @(
  "services/api/src/android-intents.mjs",
  "services/api/src/device-bridge.mjs",
  "services/api/src/script-registry.mjs",
  "bridges/windows-adb/adb-bridge.mjs",
  "scripts/android/unlockmobile.ps1",
  "scripts/android/instagram.ps1",
  "start-jazz.ps1"
)

git fetch origin main
if ($LASTEXITCODE -ne 0) { throw "git fetch origin main failed." }

git checkout origin/main -- $files
if ($LASTEXITCODE -ne 0) { throw "Could not refresh the Jazz Android control files." }

$intentFile = ".\services\api\src\android-intents.mjs"
$intentText = Get-Content $intentFile -Raw
if ($intentText -notmatch 'compound-sequence-v8-scripted-instagram') {
  throw "Android control repair failed: expected compound-sequence-v8-scripted-instagram."
}

if (-not (Test-Path ".\scripts\android\unlockmobile.ps1")) {
  throw "unlockmobile.ps1 is missing after repair."
}
if (-not (Test-Path ".\scripts\android\instagram.ps1")) {
  throw "instagram.ps1 is missing after repair."
}

Write-Host "Android command router verified: compound-sequence-v8-scripted-instagram" -ForegroundColor Green
Write-Host "unlockmobile.ps1 verified." -ForegroundColor Green
Write-Host "instagram.ps1 verified." -ForegroundColor Green
Write-Host "Restarting Jazz so no stale API/ADB bridge remains..." -ForegroundColor Yellow

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\start-jazz.ps1"
