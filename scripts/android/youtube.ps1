param(
    [string]$Serial = $env:JAZZ_ANDROID_SERIAL
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Serial)) {
    throw "JAZZ_ANDROID_SERIAL is not available to youtube.ps1."
}

$adb = if ($env:ADB_PATH) { $env:ADB_PATH } else { "adb" }
$youtubePackage = "com.google.android.youtube"
$remoteUi = "/sdcard/jazz-youtube-window.xml"

function Invoke-AdbCapture {
    param([string[]]$Arguments)

    $output = (& $adb @Arguments 2>&1 | Out-String)
    $exitCode = $LASTEXITCODE
    [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $output.Trim()
    }
}

function Has-RealLaunchError {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    return $Text -match '(?im)^\s*(?:error:|exception|unable to resolve intent|security exception|java\.lang\.)'
}

function Get-ScreenSize {
    $sizeText = (& $adb -s $Serial shell wm size 2>$null | Out-String)
    $matches = [regex]::Matches($sizeText, '(\d+)x(\d+)')
    if ($matches.Count -gt 0) {
        $last = $matches[$matches.Count - 1]
        return [pscustomobject]@{
            Width  = [int]$last.Groups[1].Value
            Height = [int]$last.Groups[2].Value
        }
    }
    return [pscustomobject]@{ Width = 1080; Height = 2400 }
}

function Get-UiXml {
    param([int]$Attempts = 7)

    for ($i = 0; $i -lt $Attempts; $i++) {
        & $adb -s $Serial shell uiautomator dump $remoteUi 2>&1 | Out-Null
        $xmlText = (& $adb -s $Serial shell cat $remoteUi 2>$null | Out-String)
        if (-not [string]::IsNullOrWhiteSpace($xmlText) -and $xmlText -match '<hierarchy') {
            return $xmlText
        }
        Start-Sleep -Milliseconds 650
    }
    return ""
}

function Get-Bounds {
    param($Node)
    if ($null -eq $Node -or $null -eq $Node.GetAttribute) { return $null }
    $bounds = [string]$Node.GetAttribute('bounds')
    $m = [regex]::Match($bounds, '\[(\d+),(\d+)\]\[(\d+),(\d+)\]')
    if (-not $m.Success) { return $null }

    $x1 = [int]$m.Groups[1].Value
    $y1 = [int]$m.Groups[2].Value
    $x2 = [int]$m.Groups[3].Value
    $y2 = [int]$m.Groups[4].Value
    if ($x2 -le $x1 -or $y2 -le $y1) { return $null }

    [pscustomobject]@{ X1 = $x1; Y1 = $y1; X2 = $x2; Y2 = $y2 }
}

function Get-ClickableAncestor {
    param($Node)

    $current = $Node
    for ($depth = 0; $depth -lt 5 -and $null -ne $current; $depth++) {
        if ($current.NodeType -eq [System.Xml.XmlNodeType]::Element) {
            $clickable = [string]$current.GetAttribute('clickable')
            $bounds = Get-Bounds $current
            if ($clickable -eq 'true' -and $null -ne $bounds) {
                return $current
            }
        }
        $current = $current.ParentNode
    }
    return $Node
}

function Find-BestResult {
    param(
        [string]$XmlText,
        [string]$SearchQuery,
        [int]$ScreenWidth,
        [int]$ScreenHeight
    )

    if ([string]::IsNullOrWhiteSpace($XmlText)) { return $null }

    try { [xml]$ui = $XmlText } catch { return $null }

    $queryLower = $SearchQuery.ToLowerInvariant().Trim()
    $tokens = @(
        $queryLower -split '[^\p{L}\p{N}]+' |
            Where-Object {
                $_.Length -ge 2 -and
                $_ -notin @('the','song','video','official','lyrics','lyric','music','audio','full')
            }
    )
    if ($tokens.Count -eq 0) { $tokens = @($queryLower) }

    $best = $null
    $bestScore = -100000
    $fallback = $null
    $fallbackDistance = [double]::MaxValue

    foreach ($node in $ui.SelectNodes('//node')) {
        $text = [System.Net.WebUtility]::HtmlDecode([string]$node.GetAttribute('text'))
        $desc = [System.Net.WebUtility]::HtmlDecode([string]$node.GetAttribute('content-desc'))
        $label = ("$text $desc" -replace '\s+', ' ').Trim()
        if ([string]::IsNullOrWhiteSpace($label)) { continue }

        $labelLower = $label.ToLowerInvariant()
        if ($labelLower -match '\b(?:ad|ads|sponsored|promotion|promoted)\b') { continue }

        $targetNode = Get-ClickableAncestor $node
        $bounds = Get-Bounds $targetNode
        if ($null -eq $bounds) { continue }

        $centerX = [int](($bounds.X1 + $bounds.X2) / 2)
        $centerY = [int](($bounds.Y1 + $bounds.Y2) / 2)
        $nodeWidth = $bounds.X2 - $bounds.X1
        $nodeHeight = $bounds.Y2 - $bounds.Y1

        if ($centerY -lt [int]($ScreenHeight * 0.14) -or $centerY -gt [int]($ScreenHeight * 0.91)) { continue }
        if ($nodeWidth -gt [int]($ScreenWidth * 0.98) -and $nodeHeight -gt [int]($ScreenHeight * 0.55)) { continue }

        $score = 0
        $matchedTokens = 0
        foreach ($token in $tokens) {
            if ($labelLower.Contains($token)) {
                $matchedTokens++
                $score += 25
            }
        }

        if ($labelLower.Contains($queryLower)) { $score += 120 }
        if ($matchedTokens -eq $tokens.Count -and $tokens.Count -gt 0) { $score += 45 }
        if ($labelLower -match '\b(?:official|video|audio|lyric|lyrics|song)\b') { $score += 6 }
        if ([string]$targetNode.GetAttribute('clickable') -eq 'true') { $score += 8 }

        if ($matchedTokens -gt 0 -and $score -gt $bestScore) {
            $bestScore = $score
            $best = [pscustomobject]@{
                X      = $centerX
                Y      = $centerY
                Label  = $label
                Score  = $score
                Method = 'ui-text-match'
            }
        }

        $looksLikeNavigation = $labelLower -match '^(home|shorts|subscriptions|library|you|search|create|notifications?)$'
        if (-not $looksLikeNavigation -and [string]$targetNode.GetAttribute('clickable') -eq 'true') {
            $distance = [math]::Abs($centerY - ($ScreenHeight * 0.36))
            if ($distance -lt $fallbackDistance) {
                $fallbackDistance = $distance
                $fallback = [pscustomobject]@{
                    X      = $centerX
                    Y      = $centerY
                    Label  = $label
                    Score  = 0
                    Method = 'first-clickable-result'
                }
            }
        }
    }

    if ($null -ne $best) { return $best }
    return $fallback
}

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
    $cleanRequest = $request -replace '(?i)^\s*(?:hey\s+)?jazz[,\s:-]*', ''
    if ($cleanRequest -match '(?i)\bplay\s+(.+)$') {
        $query = $Matches[1]
    } elseif ($cleanRequest -match '(?i)\b(?:youtube\s+search(?:\s+for)?|search\s+youtube\s+for)\s+(.+)$') {
        $query = $Matches[1]
    }
}

if ([string]::IsNullOrWhiteSpace($query)) {
    throw "youtube.ps1 did not receive a song/search query."
}

# Clean natural phrases such as: play the song 'Vaathi Coming' on YouTube.
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

# 1) Wake phone.
& $adb -s $Serial shell input keyevent KEYCODE_WAKEUP | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "ADB could not wake the Android device."
}
Start-Sleep -Milliseconds 450

# If keyguard is visibly active, do not pretend YouTube can be controlled behind it.
$windowPolicy = (& $adb -s $Serial shell dumpsys window policy 2>$null | Out-String)
if ($windowPolicy -match '(?i)(?:isKeyguardShowing|mShowingLockscreen|showing)\s*=\s*true') {
    throw "Mobile is locked. Unlock the phone first, then ask Jazz to play '$query' on YouTube."
}

# 2) Force-start a clean YouTube task.
& $adb -s $Serial shell am force-stop $youtubePackage | Out-Null
Start-Sleep -Milliseconds 500

# 3) Open YouTube search. Prefer Android's SEARCH intent because it lands directly
# inside the YouTube app. Fall back to the package-scoped YouTube results URL.
$launchMethod = "android-search-intent"
$searchLaunch = Invoke-AdbCapture @(
    '-s', $Serial,
    'shell', 'am', 'start', '-W',
    '-a', 'android.intent.action.SEARCH',
    '-p', $youtubePackage,
    '--es', 'query', $query
)

if ($searchLaunch.ExitCode -ne 0 -or (Has-RealLaunchError $searchLaunch.Output)) {
    $launchMethod = "youtube-results-url"
    $encoded = [uri]::EscapeDataString($query)
    $searchUrl = "https://www.youtube.com/results?search_query=$encoded"
    $searchLaunch = Invoke-AdbCapture @(
        '-s', $Serial,
        'shell', 'am', 'start', '-W',
        '-a', 'android.intent.action.VIEW',
        '-d', $searchUrl,
        '-p', $youtubePackage
    )
}

if ($searchLaunch.ExitCode -ne 0 -or (Has-RealLaunchError $searchLaunch.Output)) {
    throw "Could not open YouTube search for '$query'. $($searchLaunch.Output)"
}

Start-Sleep -Seconds 4

$foreground = (& $adb -s $Serial shell dumpsys window windows 2>$null |
    Select-String -Pattern 'mCurrentFocus|mFocusedApp' |
    Select-Object -First 6 |
    Out-String)
if ($foreground -and $foreground -notmatch 'com\.google\.android\.youtube') {
    throw "YouTube did not become the foreground app after searching for '$query'."
}

# 4) Read the real YouTube UI and find the best matching result. The matcher scores
# exact title text, query tokens, and clickable ancestors instead of blindly tapping
# a fixed coordinate.
$screen = Get-ScreenSize
$uiText = Get-UiXml -Attempts 8
$resultTarget = Find-BestResult -XmlText $uiText -SearchQuery $query -ScreenWidth $screen.Width -ScreenHeight $screen.Height

if ($null -eq $resultTarget) {
    # Last-resort coordinate is relative to the real screen size and aimed at the
    # first result card, not a hard-coded device-specific pixel position.
    $resultTarget = [pscustomobject]@{
        X      = [int]($screen.Width * 0.50)
        Y      = [int]($screen.Height * 0.36)
        Label  = "first visible result"
        Score  = 0
        Method = "screen-relative-fallback"
    }
}

# 5) Tap the chosen result.
& $adb -s $Serial shell input tap $resultTarget.X $resultTarget.Y | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Could not tap the YouTube result for '$query'."
}

Start-Sleep -Seconds 4

# 6) Explicitly request PLAY (not play/pause toggle) so a paused result starts.
& $adb -s $Serial shell input keyevent KEYCODE_MEDIA_PLAY | Out-Null
Start-Sleep -Milliseconds 900

$activity = (& $adb -s $Serial shell dumpsys window windows 2>$null |
    Select-String -Pattern 'mCurrentFocus|mFocusedApp' |
    Select-Object -First 6 |
    Out-String)
if ($activity -and $activity -notmatch 'com\.google\.android\.youtube') {
    throw "The YouTube result was tapped, but YouTube is not the active app."
}

$mediaSession = (& $adb -s $Serial shell dumpsys media_session 2>$null | Out-String)
$youtubeMediaSession = $mediaSession -match 'com\.google\.android\.youtube'
$playbackDetected = $youtubeMediaSession -and $mediaSession -match 'state\s*=\s*3'

[pscustomobject]@{
    ok                   = $true
    message              = "youtube.ps1 executed. Opened YouTube, searched '$query', selected the matching result, and requested playback."
    query                = $query
    serial               = $Serial
    launchMethod         = $launchMethod
    tapX                 = $resultTarget.X
    tapY                 = $resultTarget.Y
    matchedLabel         = $resultTarget.Label
    matchMethod          = $resultTarget.Method
    matchScore           = $resultTarget.Score
    youtubeMediaSession  = $youtubeMediaSession
    playbackDetected     = $playbackDetected
    script               = "youtube.ps1"
    executedScript       = $true
} | ConvertTo-Json -Compress
