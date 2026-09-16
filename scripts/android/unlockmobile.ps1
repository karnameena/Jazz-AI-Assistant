param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Serial,

    [string]$UnlockCode = $env:JAZZ_UNLOCK_CODE
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($UnlockCode)) {
    throw "JAZZ_UNLOCK_CODE is not configured in the local Jazz bridge environment."
}

$adb = if ($env:ADB_PATH) { $env:ADB_PATH } else { "adb" }

function Invoke-JazzAdb {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & $adb -s $Serial @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "ADB command failed with exit code $LASTEXITCODE."
    }
}

# This workflow is intentionally deterministic. Jazz selects this allow-listed
# script; the LLM never receives the unlock credential or constructs ADB commands.
Invoke-JazzAdb shell input keyevent KEYCODE_WAKEUP
Start-Sleep -Milliseconds 700

# Keep the exact input sequence that is known to work on Mama's authorized phone.
Invoke-JazzAdb shell input text $UnlockCode
Invoke-JazzAdb shell input keyevent KEYCODE_ENTER
Start-Sleep -Seconds 2

Write-Output "Jazz: Mobile unlock sequence completed."
