param(
    [Parameter(Mandatory = $true)]
    [string]$Serial,

    [string]$UnlockCode = $env:JAZZ_UNLOCK_CODE
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($UnlockCode)) {
    throw "JAZZ_UNLOCK_CODE is not configured. Set it as a local environment variable before running this script."
}

$adb = if ($env:ADB_PATH) { $env:ADB_PATH } else { "adb" }

& $adb -s $Serial shell input keyevent KEYCODE_WAKEUP
Start-Sleep -Seconds 1

& $adb -s $Serial shell input text $UnlockCode
& $adb -s $Serial shell input keyevent KEYCODE_ENTER
Start-Sleep -Seconds 2

Write-Host "Jazz: Android unlock sequence completed."
