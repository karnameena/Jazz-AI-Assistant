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
  "start-jazz.ps1"
)

git fetch origin main
if ($LASTEXITCODE -ne 0) { throw "git fetch origin main failed." }

git checkout origin/main -- $files
if ($LASTEXITCODE -ne 0) { throw "Could not refresh the Jazz Android control files." }

$intentFile = ".\services\api\src\android-intents.mjs"
$intentText = Get-Content $intentFile -Raw

# Do not hard-code an old intent-router version here. The router version changes as
# Android command handling is improved. Verify the current router structurally instead.
$versionMatch = [regex]::Match(
  $intentText,
  'ANDROID_INTENTS_VERSION\s*=\s*["'']([^"'']+)["'']'
)
if (-not $versionMatch.Success) {
  throw "Android control repair failed: ANDROID_INTENTS_VERSION is missing."
}
$currentIntentVersion = $versionMatch.Groups[1].Value

if ($intentText -notmatch 'scriptName:\s*["'']unlockmobile["'']') {
  throw "Android control repair failed: unlock mobile is not routed to unlockmobile script."
}
if ($intentText -notmatch 'scriptName:\s*["'']paymom["'']') {
  throw "Android control repair failed: pay-to-mom is not routed to paymom script."
}

if (-not (Test-Path ".\scripts\android\unlockmobile.ps1")) {
  throw "unlockmobile.ps1 is missing after repair."
}

Write-Host "Android command router verified: $currentIntentVersion" -ForegroundColor Green
Write-Host "unlock mobile -> unlockmobile.ps1 routing verified." -ForegroundColor Green
Write-Host "pay ... mom -> paymom registered-script routing verified." -ForegroundColor Green

# Prefer the one active IPv4:port ADB transport when Windows shows both a TCP
# transport and an mDNS alias for the same physical phone. Do not rewrite .env;
# this override is inherited only by the restarted Jazz bridge process.
try {
  $bridgeEnv = Join-Path $root "bridges\windows-adb\.env"
  $adbPath = "adb"
  if (Test-Path $bridgeEnv) {
    foreach ($line in Get-Content $bridgeEnv) {
      if ($line -match '^\s*ADB_PATH\s*=\s*(.+?)\s*$') {
        $candidate = $Matches[1].Trim().Trim('"').Trim("'")
        if ($candidate) { $adbPath = $candidate }
        break
      }
    }
  }

  $adbOutput = & $adbPath devices 2>$null
  $tcpSerials = @(
    $adbOutput |
      ForEach-Object {
        if ($_ -match '^\s*(\d{1,3}(?:\.\d{1,3}){3}:\d+)\s+device\b') { $Matches[1] }
      } |
      Sort-Object -Unique
  )

  if ($tcpSerials.Count -eq 1) {
    $env:JAZZ_ANDROID_PHONE_SERIAL = $tcpSerials[0]
    Write-Host "Using active phone ADB transport: $($tcpSerials[0])" -ForegroundColor Green
  } elseif ($tcpSerials.Count -gt 1) {
    Write-Warning "More than one TCP ADB device is active; keeping the configured Jazz phone identity."
  } else {
    Write-Warning "No active IPv4:port ADB phone transport was detected. Jazz will use its configured/reconnect identity."
  }
} catch {
  Write-Warning "Could not auto-select the active TCP ADB transport: $($_.Exception.Message)"
}

Write-Host "Restarting Jazz so no stale API/ADB bridge remains..." -ForegroundColor Yellow
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\start-jazz.ps1"
