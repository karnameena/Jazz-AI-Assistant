param(
    [Parameter(Mandatory = $true)]
    [string]$Serial,

    [string]$UnlockCode = $env:JAZZ_UNLOCK_CODE
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($UnlockCode)) {
    throw "JAZZ_UNLOCK_CODE is not configured. Set it as a local environment variable before running this script."
}

function Invoke-Adb {
    param([string[]]$Arguments)
    & adb -s $Serial @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "ADB command failed with exit code $LASTEXITCODE."
    }
}

# Wake the Android device.
Invoke-Adb @("shell", "input", "keyevent", "KEYCODE_WAKEUP")
Start-Sleep -Seconds 1

# Send the locally configured authorization/unlock code.
Invoke-Adb @("shell", "input", "text", $UnlockCode)
Invoke-Adb @("shell", "input", "keyevent", "KEYCODE_ENTER")
Start-Sleep -Seconds 2

Write-Host "Jazz: Android unlock sequence completed for $Serial."
