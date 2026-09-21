param(
    [string]$Serial = $env:JAZZ_ANDROID_SERIAL,
      [string]$UnlockCode = "8272"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Serial)) {
    throw "JAZZ_ANDROID_SERIAL is not available to unlockmobile.ps1."
}

$adb = if ($env:ADB_PATH) { $env:ADB_PATH } else { "adb" }
$request = ""
try {
    if ($env:JAZZ_SCRIPT_ARGS) {
        $scriptArgs = $env:JAZZ_SCRIPT_ARGS | ConvertFrom-Json
        if ($scriptArgs.request) { $request = [string]$scriptArgs.request }
    }
} catch {}

function Invoke-AdbText {
    param([string[]]$Arguments)
    $output = & $adb -s $Serial @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "ADB failed: $($output -join ' ')"
    }
    return ($output -join "`n")
}

function Get-DeviceLocked {
    try {
        $trust = Invoke-AdbText @("shell", "dumpsys", "trust")
        $match = [regex]::Match($trust, 'deviceLocked=(true|false)', 'IgnoreCase')
        if ($match.Success) {
            return ($match.Groups[1].Value -ieq "true")
        }
    } catch {}

    try {
        $window = Invoke-AdbText @("shell", "dumpsys", "window", "policy")
        if ($window -match '(?i)(?:keyguardShowing|showing)=true') { return $true }
        if ($window -match '(?i)(?:keyguardShowing|showing)=false') { return $false }
    } catch {}

    return $null
}

Invoke-AdbText @("shell", "input", "keyevent", "KEYCODE_WAKEUP") | Out-Null
Start-Sleep -Milliseconds 500

Invoke-AdbText @("shell", "input", "swipe", "500", "1500", "500", "500", "500") | Out-Null

 Invoke-AdbText @("shell", "input", "text", "$UnlockCode") | Out-Null



$compoundRequest = $request -match '(?i)\b(?:open|launch|start|scroll|swipe|reels?|youtube|instagram|whatsapp|home|back)\b'
$locked = Get-DeviceLocked
$waited = $false

if ($compoundRequest -and $locked -ne $false) {
    $waited = $true
    $deadline = (Get-Date).AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 500
        $locked = Get-DeviceLocked
        if ($locked -eq $false) { break }
    } while ((Get-Date) -lt $deadline)
}

if ($locked -eq $false) {
    [pscustomobject]@{
        ok                      = $true
        status                  = "unlocked"
        message                 = "Yep mama !executed. Mobile is awake and unlocked."
        script                  = "unlockmobile.ps1"
        executedScript          = $true
        locked                  = $false
        waitedForAuthentication = $waited
    } | ConvertTo-Json -Compress
    exit 0
}

[pscustomobject]@{
    ok                      = $true
    status                  = "authentication_required"
    message                 = "hey mama Mobile is awake, but the keyguard is still locked. Authenticate on the device before the remaining actions can continue."
    script                  = "unlockmobile.ps1"
    executedScript          = $true
    locked                  = if ($null -eq $locked) { $null } else { [bool]$locked }
    waitedForAuthentication = $waited
} | ConvertTo-Json -Compress
