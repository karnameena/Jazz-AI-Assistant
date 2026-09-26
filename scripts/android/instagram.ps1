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
        if ($activity -match '(?im)(?:mResumedActivity|topResumedActivity).*com\.instagram\.android') { return $true }
    } catch {}
    try {
        $window = Invoke-Adb @("shell", "dumpsys", "window", "windows")
        if ($window -match '(?im)mCurrentFocus.*com\.instagram\.android') { return $true }
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

function Get-InstagramUiXml {
    try {
        Invoke-Adb @("shell", "uiautomator", "dump", "/sdcard/jazz_instagram_ui.xml") | Out-Null
        return Invoke-Adb @("shell", "cat", "/sdcard/jazz_instagram_ui.xml")
    } catch {
        return ""
    }
}

function Get-NodeBoundsByAccessibleLabel {
    param(
        [string]$Xml,
        [string[]]$Labels
    )
    if ([string]::IsNullOrWhiteSpace($Xml)) { return $null }

    foreach ($label in $Labels) {
        $escaped = [regex]::Escape($label)
        $pattern1 = '<node[^>]*(?:text|content-desc)="' + $escaped + '"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
        $pattern2 = '<node[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*(?:text|content-desc)="' + $escaped + '"'
        foreach ($pattern in @($pattern1, $pattern2)) {
            $match = [regex]::Match($Xml, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
            if ($match.Success) {
                return @{
                    Label = $label
                    Left = [int]$match.Groups[1].Value
                    Top = [int]$match.Groups[2].Value
                    Right = [int]$match.Groups[3].Value
                    Bottom = [int]$match.Groups[4].Value
                }
            }
        }
    }
    return $null
}

function Test-LikeState {
    param([string]$Xml)
    if ([string]::IsNullOrWhiteSpace($Xml)) { return "unknown" }

    if ($Xml -match '(?i)(?:text|content-desc)="(?:Unlike|Remove like|Liked)"') { return "liked" }
    if ($Xml -match '(?i)(?:text|content-desc)="Like"') { return "not_liked" }
    return "unknown"
}

function Invoke-LikeCurrentReel {
    if (-not (Test-InstagramForeground)) {
        return @{ Ok = $false; Status = "WRONG_SCREEN"; Message = "Instagram is not the current foreground app." }
    }

    $xmlBefore = Get-InstagramUiXml
    if ([string]::IsNullOrWhiteSpace($xmlBefore)) {
        return @{ Ok = $false; Status = "UI_UNAVAILABLE"; Message = "I could not inspect the current Instagram screen, so I did not claim the reel was liked." }
    }

    $beforeState = Test-LikeState $xmlBefore
    if ($beforeState -eq "liked") {
        return @{ Ok = $true; Status = "ALREADY_LIKED"; Message = "This Instagram reel/video is already liked." }
    }

    $likeNode = Get-NodeBoundsByAccessibleLabel -Xml $xmlBefore -Labels @("Like")
    if ($null -eq $likeNode) {
        return @{ Ok = $false; Status = "LIKE_CONTROL_NOT_FOUND"; Message = "I could not find a visible Instagram Like control on the current screen, so I stopped without guessing." }
    }

    $tapX = [int](($likeNode.Left + $likeNode.Right) / 2)
    $tapY = [int](($likeNode.Top + $likeNode.Bottom) / 2)
    Invoke-Adb @("shell", "input", "tap", "$tapX", "$tapY") | Out-Null

    for ($attempt = 0; $attempt -lt 8; $attempt++) {
        Start-Sleep -Milliseconds 300
        if (-not (Test-InstagramForeground)) {
            return @{ Ok = $false; Status = "WRONG_SCREEN"; Message = "Instagram left the foreground before I could verify the Like action." }
        }
        $xmlAfter = Get-InstagramUiXml
        $afterState = Test-LikeState $xmlAfter
        if ($afterState -eq "liked") {
            return @{ Ok = $true; Status = "LIKE_VERIFIED"; Message = "Liked the current Instagram reel/video and verified the Like state on screen." }
        }
    }

    return @{ Ok = $false; Status = "LIKE_NOT_VERIFIED"; Message = "I tapped Instagram's Like control, but I could not verify that the reel became liked. I am not reporting success." }
}

function Tap-ReelsTabFromUi {
    for ($attempt = 0; $attempt -lt 4; $attempt++) {
        $xml = Get-InstagramUiXml
        if (-not [string]::IsNullOrWhiteSpace($xml)) {
            $node = Get-NodeBoundsByAccessibleLabel -Xml $xml -Labels @("Reels")
            if ($null -ne $node) {
                $x = [int](($node.Left + $node.Right) / 2)
                $y = [int](($node.Top + $node.Bottom) / 2)
                Invoke-Adb @("shell", "input", "tap", "$x", "$y") | Out-Null
                Start-Sleep -Milliseconds 1300
                return $true
            }
        }
        Start-Sleep -Milliseconds 350
    }
    return $false
}

function Tap-ReelsTabFallback {
    $size = Get-ScreenSize
    $x = [int]([int]$size.Width * 0.70)
    $y = [int]([int]$size.Height * 0.92)
    Invoke-Adb @("shell", "input", "tap", "$x", "$y") | Out-Null
    Start-Sleep -Milliseconds 1400
}

function Open-InstagramReels {
    try {
        Invoke-Adb @("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", "instagram://reels", "-p", "com.instagram.android") | Out-Null
        Start-Sleep -Milliseconds 1300
    } catch {
        Start-Instagram
    }

    if (-not (Test-InstagramForeground)) { Start-Instagram }
    if (-not (Test-InstagramForeground)) { return $false }

    if (-not (Tap-ReelsTabFromUi)) { Tap-ReelsTabFallback }
    return (Test-InstagramForeground)
}

$wantsReels = $request -match '(?i)\b(?:reel|reels|video|videos)\b'
$swipeUp = $request -match '(?i)\b(?:scroll\s+up|swipe\s+up|next\s+reel|next\s+video)\b'
$swipeDown = $request -match '(?i)\b(?:scroll\s+down|swipe\s+down|previous\s+reel|previous\s+video)\b'
$likeCurrent = $request -match '(?i)^(?:\s*(?:hey\s+)?jazz[,\s:-]*)?(?:like|heart)(?:\s+(?:this|the|current))?\s+(?:reel|video)[.!? ]*$' -or
               $request -match '(?i)^(?:\s*(?:hey\s+)?jazz[,\s:-]*)?double\s+tap(?:\s+(?:this|the|current))?\s+(?:reel|video)[.!? ]*$'

if ($likeCurrent -and (Test-InstagramForeground)) {
    # Preserve the reel the user is already viewing.
} elseif ($wantsReels) {
    if (-not (Open-InstagramReels)) { throw "Instagram Reels could not be opened." }
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

if ($swipeUp) {
    Invoke-Adb @("shell", "input", "swipe", "$x", "$bottom", "$x", "$top", "360") | Out-Null
    Start-Sleep -Milliseconds 520
} elseif ($swipeDown) {
    Invoke-Adb @("shell", "input", "swipe", "$x", "$top", "$x", "$bottom", "360") | Out-Null
    Start-Sleep -Milliseconds 520
}

$likeResult = $null
if ($likeCurrent) {
    $likeResult = Invoke-LikeCurrentReel
    if (-not $likeResult.Ok) {
        [pscustomobject]@{
            ok                 = $false
            status             = $likeResult.Status
            message            = $likeResult.Message
            script             = "instagram.ps1"
            executedScript     = $true
            foregroundVerified = (Test-InstagramForeground)
            reelsRequested     = $wantsReels
            swipedUp           = $swipeUp
            swipedDown         = $swipeDown
            likedCurrent       = $false
            likeVerified       = $false
        } | ConvertTo-Json -Compress
        exit 0
    }
}

if (-not (Test-InstagramForeground)) {
    throw "Instagram stopped being the foreground app before the requested reel action completed."
}

$message = if ($likeCurrent) {
    $likeResult.Message
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
    status             = if ($likeCurrent) { $likeResult.Status } else { "completed" }
    message            = $message
    script             = "instagram.ps1"
    executedScript     = $true
    foregroundVerified = $true
    reelsRequested     = $wantsReels
    swipedUp           = $swipeUp
    swipedDown         = $swipeDown
    likedCurrent       = ($likeCurrent -and $likeResult.Ok)
    likeVerified       = ($likeCurrent -and $likeResult.Ok)
} | ConvertTo-Json -Compress
