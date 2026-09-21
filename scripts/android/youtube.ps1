param(
    [string]$Serial = $env:JAZZ_ANDROID_SERIAL
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Serial)) {
    throw "JAZZ_ANDROID_SERIAL is not available to youtube.ps1."
}

$adb = if ($env:ADB_PATH) { $env:ADB_PATH } else { "adb" }

$request = $null
$query = $null
try {
    if ($env:JAZZ_SCRIPT_ARGS) {
        $scriptArgs = $env:JAZZ_SCRIPT_ARGS | ConvertFrom-Json
        $query = [string]$scriptArgs.query
        $request = [string]$scriptArgs.request
    }
} catch {}

if ([string]::IsNullOrWhiteSpace($query) -and -not [string]::IsNullOrWhiteSpace($request)) {
    if ($request -match '(?i)\bplay\s+(.+)$') {
        $query = $Matches[1]
    }
}

if ([string]::IsNullOrWhiteSpace($query)) {
    throw "youtube.ps1 did not receive a song/search query."
}

# Clean natural phrases such as: play the song 'Vaathi Coming'
$query = $query `
    -replace '(?i)^\s*(?:the\s+)?(?:song|video|music|track)\s+', '' `
    -replace '^[\s''"‘’“”`]+', '' `
    -replace '[\s''"‘’“”`.,!?;:]+$', '' `
    -replace '(?i)\s+(?:on|in)\s+youtube(?:\s+music)?\s*$', '' `
    -replace '(?i)\s+(?:on|in)\s+(?:my\s+)?(?:mobile|phone|tablet)\s*$', '' `
    -replace '(?i)\s+(?:please|jazz)\s*$', ''
$query = $query.Trim()

if ([string]::IsNullOrWhiteSpace($query)) {
    throw "youtube.ps1 received an empty YouTube query."
}

# Wake the screen.
& $adb -s $Serial shell input keyevent KEYCODE_WAKEUP | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "ADB could not wake the Android device."
}
Start-Sleep -Milliseconds 400

# Start from a clean YouTube task. When YouTube was already open Android returned
# "Activity not started, its current task has been brought to the front" even though
# the command succeeded. The old script incorrectly treated that normal warning as
# a failure. Force-stopping first also makes the search deep-link deterministic.
& $adb -s $Serial shell am force-stop com.google.android.youtube | Out-Null
Start-Sleep -Milliseconds 350

$encoded = [uri]::EscapeDataString($query)
$searchUrl = "https://www.youtube.com/results?search_query=$encoded"
$viewArgs = @(
    '-s', $Serial,
    'shell', 'am', 'start', '-W',
    '-a', 'android.intent.action.VIEW',
    '-d', $searchUrl,
    '-p', 'com.google.android.youtube'
)

$viewOutput = (& $adb @viewArgs 2>&1 | Out-String)
$viewExit = $LASTEXITCODE

# Do not fail merely because Android prints "Activity not started". That message can
# mean the existing task was reused successfully. Fail only for a real adb/intent error.
$realLaunchError = $viewOutput -match '(?im)^\s*(?:error:|exception|unable to resolve intent|security exception|java\.lang\.)'
if ($viewExit -ne 0 -or $realLaunchError) {
    throw "Could not open YouTube search results for '$query'. $($viewOutput.Trim())"
}

Start-Sleep -Seconds 4

# Confirm YouTube actually became the foreground app before interacting with it.
$foreground = (& $adb -s $Serial shell dumpsys activity activities 2>$null |
    Select-String -Pattern 'mResumedActivity|topResumedActivity' |
    Select-Object -First 4 |
    Out-String)
if ($foreground -and $foreground -notmatch 'com\.google\.android\.youtube') {
    throw "YouTube did not become the active app after opening search results."
}

# Read the actual YouTube accessibility tree and tap the result whose visible text
# best matches the requested song. This avoids hard-coded coordinates where possible.
$remoteUi = '/sdcard/jazz-youtube-window.xml'
& $adb -s $Serial shell uiautomator dump $remoteUi 2>&1 | Out-Null
$uiText = (& $adb -s $Serial shell cat $remoteUi 2>$null | Out-String)

$tapX = $null
$tapY = $null
$matchMethod = 'fallback-coordinate'

if (-not [string]::IsNullOrWhiteSpace($uiText) -and $uiText -match '<hierarchy') {
    try {
        [xml]$ui = $uiText
        $tokens = @(
            ($query.ToLowerInvariant() -split '[^\p{L}\p{N}]+' |
                Where-Object { $_.Length -ge 3 -and $_ -notin @('the','song','video','official','lyrics','lyric','music','audio') })
        )

        if ($tokens.Count -eq 0) {
            $tokens = @($query.ToLowerInvariant())
        }

        $best = $null
        $bestScore = -1
        foreach ($node in $ui.SelectNodes('//node')) {
            $text = [System.Net.WebUtility]::HtmlDecode([string]$node.GetAttribute('text'))
            $desc = [System.Net.WebUtility]::HtmlDecode([string]$node.GetAttribute('content-desc'))
            $label = ("$text $desc").ToLowerInvariant().Trim()
            if ([string]::IsNullOrWhiteSpace($label)) { continue }

            $score = 0
            foreach ($token in $tokens) {
                if ($label.Contains($token)) { $score++ }
            }
            if ($score -le 0) { continue }

            $bounds = [string]$node.GetAttribute('bounds')
            $m = [regex]::Match($bounds, '\[(\d+),(\d+)\]\[(\d+),(\d+)\]')
            if (-not $m.Success) { continue }

            $x1 = [int]$m.Groups[1].Value
            $y1 = [int]$m.Groups[2].Value
            $x2 = [int]$m.Groups[3].Value
            $y2 = [int]$m.Groups[4].Value
            if ($x2 -le $x1 -or $y2 -le $y1) { continue }

            $clickBonus = if ($node.GetAttribute('clickable') -eq 'true') { 2 } else { 0 }
            $effectiveScore = ($score * 10) + $clickBonus
            if ($effectiveScore -gt $bestScore) {
                $bestScore = $effectiveScore
                $best = @{
                    X = [int](($x1 + $x2) / 2)
                    Y = [int](($y1 + $y2) / 2)
                    Label = $label
                }
            }
        }

        if ($null -ne $best) {
            $tapX = $best.X
            $tapY = $best.Y
            $matchMethod = 'ui-text-match'
        }
    } catch {}
}

if ($null -eq $tapX -or $null -eq $tapY) {
    $sizeText = (& $adb -s $Serial shell wm size | Out-String)
    $matches = [regex]::Matches($sizeText, '(\d+)x(\d+)')
    if ($matches.Count -gt 0) {
        $last = $matches[$matches.Count - 1]
        $width = [int]$last.Groups[1].Value
        $height = [int]$last.Groups[2].Value
    } else {
        $width = 1080
        $height = 2400
    }

    $tapX = [int]($width * 0.50)
    $tapY = [int]($height * 0.34)
}

& $adb -s $Serial shell input tap $tapX $tapY | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Could not tap the YouTube result for '$query'."
}

Start-Sleep -Seconds 3

# Explicitly request PLAY so an opened result starts/resumes playback.
& $adb -s $Serial shell input keyevent KEYCODE_MEDIA_PLAY | Out-Null
Start-Sleep -Milliseconds 700

$activity = (& $adb -s $Serial shell dumpsys activity activities 2>$null |
    Select-String -Pattern 'mResumedActivity|topResumedActivity' |
    Select-Object -First 3 |
    Out-String)
if ($activity -and $activity -notmatch 'com\.google\.android\.youtube') {
    throw "The YouTube result was selected, but YouTube is not the active app."
}

[pscustomobject]@{
    ok             = $true
    message        = "youtube.ps1 executed. Playing '$query' on YouTube."
    query          = $query
    tapX           = $tapX
    tapY           = $tapY
    matchMethod    = $matchMethod
    script         = "youtube.ps1"
    executedScript = $true
} | ConvertTo-Json -Compress
