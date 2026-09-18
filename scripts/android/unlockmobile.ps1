param(
    [string]$Serial = $env:JAZZ_ANDROID_SERIAL
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Serial)) {
    throw "JAZZ_ANDROID_SERIAL is not available to unlockmobile.ps1."
}

$adb = if ($env:ADB_PATH) { $env:ADB_PATH } else { "adb" }

# Registered workflow for the phrase "unlock mobile".
# Jazz wakes the device through ADB; PIN/biometric authentication stays on-device.
& $adb -s $Serial shell input keyevent KEYCODE_WAKEUP
if ($LASTEXITCODE -ne 0) {
    throw "ADB could not wake the Android device."
}

Start-Sleep -Milliseconds 500

[pscustomobject]@{
    ok             = $true
    status         = "authentication_required"
    message        = "unlockmobile.ps1 executed. Mobile is awake. Authenticate on the device, then Jazz can continue."
    script         = "unlockmobile.ps1"
    executedScript = $true
} | ConvertTo-Json -Compress
