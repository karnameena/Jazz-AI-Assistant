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

    Start-Sleep -Milliseconds 1400
}

function Open-InstagramReels {
    try {
        Invoke-Adb @("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", "instagram://reels", "-p", "com.instagram.android") | Out-Null
        Start-Sleep -Milliseconds 1600
        if (Test-InstagramForeground) { return $true }
    } catch {}

    Start-Instagram
    return (Test-InstagramForeground)
}

function Get-ScreenSize {
    $sizeText = Invoke-Adb @("shell", "wm", "size")
    $matches = [regex]::Matches($sizeText, '(\d+)x(\d+)')
    $width = 1080
    $height = 2400
    if ($matches.Count -gt 0) {
        $last = $matches[$matches.Count - 1]
        $width = [int]$last.Groups[1].Value
        $height = [int]$last.Groups[2].Value
    }
    return @{ Width = $width; Height = $height }
}

$wantsReels = $request -match '(?i)\b(?:reel|reels|video|videos)\b'
$swipeUp = $request -match '(?i)\b(?:scroll\s+up|swipe\s+up|next\s+reel|next\s+video)\b'
$swipeDown = $request -match '(?i)\b(?:scroll\s+down|swipe\s+down|previous\s+reel|previous\s+video)\b'
$likeCurrent = $request -match '(?i)^(?:\s*(?:hey\s+)?jazz[,\s:-]*)?(?:like|heart)(?:\s+(?:this|the|current))?\s+(?:reel|video)[.!? ]*$' -or
               $request -match '(?i)^(?:\s*(?:hey\s+)?jazz[,\s:-]*)?double\s+tap(?:\s+(?:this|the|current))?\s+(?:reel|video)[.!? ]*$'

# For a like command, preserve the reel the user is already watching. For an explicit
# open-reel command, use Instagram's reels deep link first and fall back to normal launch.
if ($likeCurrent -and (Test-InstagramForeground)) {
    # Keep current foreground reel/video exactly where it is.
} elseif ($wantsReels) {
    if (-not (Open-InstagramReels)) {
        throw "Instagram Reels could not be opened."
    }
} else {
    Start-Instagram
    if (-not (Test-InstagramForeground)) { Start-Instagram }
}

if (-not (Test-InstagramForeground)) {
    throw "Instagram launch was requested, but com.instagram.android did not become the foreground app."
}

$size = Get-ScreenSize
$width = [int]$size.Width
$height = [int]$size.Height
$x = [int]($width * 0.5)
$top = [int]($height * 0.28)
$bottom = [int]($height * 0.78)
$centerY = [int]($height * 0.48)

if ($swipeUp) {
    Invoke-Adb @("shell", "input", "swipe", "$x", "$bottom", "$x", "$top", "360") | Out-Null
    Start-Sleep -Milliseconds 520
} elseif ($swipeDown) {
    Invoke-Adb @("shell", "input", "swipe", "$x", "$top", "$x", "$bottom", "360") | Out-Null
    Start-Sleep -Milliseconds 520
}

if ($likeCurrent) {
    Invoke-Adb @("shell", "input", "tap", "$x", "$centerY") | Out-Null
    Start-Sleep -Milliseconds 110
    Invoke-Adb @("shell", "input", "tap", "$x", "$centerY") | Out-Null
    Start-Sleep -Milliseconds 300
}

if (-not (Test-InstagramForeground)) {
    throw "Instagram stopped being the foreground app before the requested reel action completed."
}

$message = if ($likeCurrent) {
    "Liked the current Instagram reel/video with a double tap."
} elseif ($swipeUp -and $wantsReels) {
    "Instagram Reels opened and scrolled up."
} elseif ($swipeDown -and $wantsReels) {
    "Instagram Reels opened and scrolled down."
} elseif ($wantsReels) {
    "Instagram Reels opened."
} elseif ($swipeUp) {
    "Instagram opened and scrolled up."
} elseif ($swipeDown) {
    "Instagram opened and scrolled down."
} else {
    "Instagram opened."
}

[pscustomobject]@{
    ok                 = $true
    status             = "completed"
    message            = $message
    script             = "instagram.ps1"
    executedScript     = $true
    foregroundVerified = $true
    reelsRequested     = $wantsReels
    swipedUp           = $swipeUp
    swipedDown         = $swipeDown
    likedCurrent       = $likeCurrent
} | ConvertTo-Json -Compress