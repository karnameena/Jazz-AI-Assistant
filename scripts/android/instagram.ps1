param(
    [string]$Serial = $env:JAZZ_ANDROID_SERIAL
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Serial)) {
    throw "JAZZ_ANDROID_SERIAL is not available to instagram.ps1."
}

$adb = if ($env:ADB_PATH) { $env:ADB_PATH } else { "adb" }
$request = ""
try {
    if ($env:JAZZ_SCRIPT_ARGS) {
        $scriptArgs = $env:JAZZ_SCRIPT_ARGS | ConvertFrom-Json
        if ($scriptArgs.request) { $request = [string]$scriptArgs.request }
    }
} catch {}

function Invoke-Adb {
    param([string[]]$Arguments)
    $output = & $adb -s $Serial @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "ADB failed: $($output -join ' ')"
    }
    return ($output -join "`n")
}

function Test-InstagramForeground {
    try {
        $activity = Invoke-Adb @("shell", "dumpsys", "activity", "activities")
        if ($activity -match '(?im)(?:mResumedActivity|topResumedActivity).*com\.instagram\.android') {
            return $true
        }
    } catch {}

    try {
        $window = Invoke-Adb @("shell", "dumpsys", "window", "windows")
        if ($window -match '(?im)mCurrentFocus.*com\.instagram\.android') {
            return $true
        }
    } catch {}

    return $false
}

function Start-Instagram {
    $component = ""
    try {
        $resolved = Invoke-Adb @("shell", "cmd", "package", "resolve-activity", "--brief", "com.instagram.android")
        $component = ($resolved -split "`r?`n" | Where-Object { $_ -match '^com\.instagram\.android/' } | Select-Object -Last 1)
    } catch {}

    if (-not [string]::IsNullOrWhiteSpace($component)) {
        Invoke-Adb @("shell", "am", "start", "-W", "-n", $component.Trim()) | Out-Null
    } else {
        Invoke-Adb @("shell", "monkey", "-p", "com.instagram.android", "-c", "android.intent.category.LAUNCHER", "1") | Out-Null
    }

    Start-Sleep -Milliseconds 1600
}

Start-Instagram
if (-not (Test-InstagramForeground)) {
    Start-Instagram
}

if (-not (Test-InstagramForeground)) {
    throw "Instagram launch was requested, but com.instagram.android did not become the foreground app."
}

$swipeUp = $request -match '(?i)\b(?:scroll\s+up|swipe\s+up|next\s+reel|next\s+video)\b'
$swipeDown = $request -match '(?i)\b(?:scroll\s+down|swipe\s+down|previous\s+reel|previous\s+video)\b'

if ($swipeUp -or $swipeDown) {
    $sizeText = Invoke-Adb @("shell", "wm", "size")
    $matches = [regex]::Matches($sizeText, '(\d+)x(\d+)')
    $width = 1080
    $height = 2400
    if ($matches.Count -gt 0) {
        $last = $matches[$matches.Count - 1]
        $width = [int]$last.Groups[1].Value
        $height = [int]$last.Groups[2].Value
    }

    $x = [int]($width * 0.5)
    $top = [int]($height * 0.28)
    $bottom = [int]($height * 0.78)

    if ($swipeUp) {
        Invoke-Adb @("shell", "input", "swipe", "$x", "$bottom", "$x", "$top", "420") | Out-Null
    } elseif ($swipeDown) {
        Invoke-Adb @("shell", "input", "swipe", "$x", "$top", "$x", "$bottom", "420") | Out-Null
    }

    Start-Sleep -Milliseconds 650
    if (-not (Test-InstagramForeground)) {
        throw "Instagram stopped being the foreground app before the swipe workflow completed."
    }
}

$message = if ($swipeUp) {
    "instagram.ps1 executed. Instagram opened and swiped up."
} elseif ($swipeDown) {
    "instagram.ps1 executed. Instagram opened and swiped down."
} else {
    "instagram.ps1 executed. Instagram opened."
}

[pscustomobject]@{
    ok                 = $true
    status             = "completed"
    message            = $message
    script             = "instagram.ps1"
    executedScript     = $true
    foregroundVerified = $true
    swipedUp           = $swipeUp
    swipedDown         = $swipeDown
} | ConvertTo-Json -Compress
