param(
    [Parameter(Mandatory = $true)]
    [string]$Serial
)

$ErrorActionPreference = "Stop"

$adb = if ($env:ADB_PATH) { $env:ADB_PATH } else { "adb" }

& $adb -s $Serial shell input keyevent KEYCODE_WAKEUP
if ($LASTEXITCODE -ne 0) {
    throw "ADB could not wake the Android device."
}

Start-Sleep -Milliseconds 500

Write-Output "Mobile is awake. Authenticate on the device, then Jazz can continue."
