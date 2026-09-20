$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$bridgeDir = Join-Path $root "bridges\windows-adb"
$envFile = Join-Path $bridgeDir ".env"
$bridgeFile = Join-Path $bridgeDir "adb-bridge.mjs"
$logDir = Join-Path $root ".jazz\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (-not (Test-Path $envFile)) {
    throw "Jazz ADB bridge .env not found: $envFile"
}

$envText = Get-Content $envFile -Raw
$adbPath = $null
if ($envText -match '(?m)^ADB_PATH=(.+)$') {
    $adbPath = $Matches[1].Trim().Trim('"')
}
if ([string]::IsNullOrWhiteSpace($adbPath)) {
    $adbCommand = Get-Command adb -ErrorAction SilentlyContinue
    if ($adbCommand) { $adbPath = $adbCommand.Source }
}
if ([string]::IsNullOrWhiteSpace($adbPath) -or -not (Test-Path $adbPath)) {
    throw "ADB executable was not found. Check ADB_PATH in bridges/windows-adb/.env."
}

Write-Host "Detecting currently connected Android transports..." -ForegroundColor Cyan
$deviceLines = & $adbPath devices | Select-Object -Skip 1 | Where-Object { $_ -match '\sdevice\s*$' }
$serials = @($deviceLines | ForEach-Object { ($_ -split '\s+')[0].Trim() } | Where-Object { $_ })
if ($serials.Count -eq 0) {
    throw "No authorized Android device is currently connected through ADB."
}

$tcpSerials = @($serials | Where-Object { $_ -match '^\d{1,3}(?:\.\d{1,3}){3}:\d+$' })
$mdnsSerials = @($serials | Where-Object { $_ -like 'adb-*._adb-tls-connect._tcp' })

# Prefer the concrete IPv4:port transport. It is deterministic for scripts using -s
# and avoids the 'more than one device/emulator' ambiguity inside Jazz workflows.
$selected = if ($tcpSerials.Count -gt 0) { $tcpSerials[0] } else { $serials[0] }

Write-Host "Selected Jazz phone transport: $selected" -ForegroundColor Green
if ($serials.Count -gt 1) {
    Write-Host "ADB currently exposes the phone through multiple transports; Jazz will pin commands to the selected transport." -ForegroundColor Yellow
}

$lines = @(Get-Content $envFile)
$updated = $false
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^JAZZ_ANDROID_PHONE_SERIAL=') {
        $lines[$i] = "JAZZ_ANDROID_PHONE_SERIAL=$selected"
        $updated = $true
        break
    }
}
if (-not $updated) {
    $lines += "JAZZ_ANDROID_PHONE_SERIAL=$selected"
}
Set-Content -Path $envFile -Value $lines -Encoding UTF8

# Restart only the bridge. The API does not need a restart because it talks to the
# bridge through localhost:9899 and the bridge injects the selected serial into scripts.
try {
    $listeners = Get-NetTCPConnection -LocalPort 9899 -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in @($listeners)) {
        if ($listener.OwningProcess) {
            Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
} catch {}
Start-Sleep -Milliseconds 500

$node = Get-Command node -ErrorAction Stop
$bridgeOut = Join-Path $logDir "bridge.out.log"
$bridgeErr = Join-Path $logDir "bridge.err.log"
Remove-Item $bridgeOut,$bridgeErr -Force -ErrorAction SilentlyContinue

$process = Start-Process -FilePath $node.Source `
    -ArgumentList @("--env-file=$envFile", $bridgeFile) `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $bridgeOut `
    -RedirectStandardError $bridgeErr `
    -PassThru

$ready = $false
for ($attempt = 1; $attempt -le 20; $attempt++) {
    Start-Sleep -Milliseconds 300
    if ($process.HasExited) { break }
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:9899/health" -TimeoutSec 2
        if ($health.ok) { $ready = $true; break }
    } catch {}
}

if (-not $ready) {
    $detail = if (Test-Path $bridgeErr) { (Get-Content $bridgeErr -Tail 20 -ErrorAction SilentlyContinue) -join "`n" } else { "" }
    throw "Jazz ADB bridge did not restart successfully.$([Environment]::NewLine)$detail"
}

$devices = Invoke-RestMethod "http://127.0.0.1:9899/devices" -TimeoutSec 8
$phone = $devices.targets.'android-phone'
if (-not $phone.connected) {
    throw "Jazz bridge restarted, but android-phone is not connected."
}

Write-Host "Jazz ADB phone FIXED." -ForegroundColor Green
Write-Host "Active serial: $($phone.serial)" -ForegroundColor Green
Write-Host "Bridge: http://127.0.0.1:9899" -ForegroundColor DarkGray
Write-Host "Your token and all other private .env values were preserved." -ForegroundColor DarkGray
