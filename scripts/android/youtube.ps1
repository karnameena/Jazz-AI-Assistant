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

function Get-ForegroundSnapshot {
    $window = (& $adb -s $Serial shell dumpsys window windows 2>$null |
        Select-String -Pattern 'mCurrentFocus|mFocusedApp' |
        Select-Object -First 8 |
        Out-String)

    $activity = (& $adb -s $Serial shell dumpsys activity activities 2>$null |
        Select-String -Pattern 'mResumedActivity|topResumedActivity|ResumedActivity' |
        Select-Object -First 8 |
        Out-String)

    return "$window`n$activity"
}

function Test-YouTubeForeground {
    return (Get-ForegroundSnapshot) -match 'com\.google\.android\.youtube'
}

function Wait-YouTubeForeground {
    param([int]$Attempts = 12, [int]$DelayMs = 450)

    for ($i = 0; $i -lt $Attempts; $i++) {
        if (Test-YouTubeForeground) { return $true }
        Start-Sleep -Milliseconds $DelayMs
    }
    return $false
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
    if ($null -eq $Node) { return $null }

    $bounds = [string]$Node.GetAttribute('bounds')
    $m = [regex]::Match($bounds, '\[(\d+),(\d+)\]\[(\d+),(\d+)\]')
    if (-not $m.Success) { return $null }

    $x1 = [int]$m.Groups[1].Value
    $y1 = [int]$m.Groups[2].Value
    $x2 = [int]$m.Groups[3].Value
    $y2 = [int]$m.Groups[4].Value
    if ($x2 -le $x1 -or $y2 -le $y1) { return $null }

    return [pscustomobject]@{ X1 = $x1; Y1 = $y1; X2 = $x2; Y2 = $y2 }
}

function Get-ClickableAncestor {
    param($Node)

    $current = $Node
    for ($depth = 0; $depth -lt 6 -and $null -ne $current; $depth++) {
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

function Find-SearchControl {
    param([string]$XmlText)

    if ([string]::IsNullOrWhiteSpace($XmlText)) { return $null }
    try { [xml]$ui = $XmlText } catch { return $null }

    $best = $null
    $bestScore = -1
    foreach ($node in $ui.SelectNodes('//node')) {
        $text = [System.Net.WebUtility]::HtmlDecode([string]$node.GetAttribute('text'))
        $desc = [System.Net.WebUtility]::HtmlDecode([string]$node.GetAttribute('content-desc'))
        $class = [string]$node.GetAttribute('class')
        $label = ("$text $desc" -replace '\s+', ' ').Trim()
        $labelLower = $label.ToLowerInvariant()

        $score = 0
        if ($class -match 'EditText') { $score += 120 }
        if ($labelLower -eq 'search') { $score += 100 }
        if ($labelLower -match '\bsearch youtube\b') { $score += 90 }
        if ($labelLower -match '^search\b') { $score += 70 }
        if ($score -le 0) { continue }

        $targetNode = Get-ClickableAncestor $node
        $bounds = Get-Bounds $targetNode
        if ($null -eq $bounds) { $bounds = Get-Bounds $node }
        if ($null -eq $bounds) { continue }

        if ($score -gt $bestScore) {
            $bestScore = $score
            $best = [pscustomobject]@{
                X = [int](($bounds.X1 + $bounds.X2) / 2)
                Y = [int](($bounds.Y1 + $bounds.Y2) / 2)
                Label = $label
                Class = $class
            }
        }
    }

    return $best
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

        if ($centerY -lt [int]($ScreenHeight * 0.13) -or $centerY -gt [int]($ScreenHeight * 0.92)) { continue }
        if ($nodeWidth -gt [int]($ScreenWidth * 0.98) -and $nodeHeight -gt [int]($ScreenHeight * 0.55)) { continue }

        $score = 0
        $matchedTokens = 0
        foreach ($token in $tokens) {
            if ($labelLower.Contains($token)) {
                $matchedTokens++
                $score += 30
            }
        }

        if ($labelLower.Contains($queryLower)) { $score += 140 }
        if ($matchedTokens -eq $tokens.Count -and $tokens.Count -gt 0) { $score += 60 }
        if ($labelLower -match '\b(?:official|video|audio|lyric|lyrics|song)\b') { $score += 8 }
        if (([string]$targetNode.GetAttribute('clickable')) -eq 'true') { $score += 8 }

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
    }

    return $best
}

function Start-YouTubeHome {
    & $adb -s $Serial shell am force-stop $youtubePackage 2>$null | Out-Null
    Start-Sleep -Milliseconds 350

    $launch = Invoke-AdbCapture @(
        '-s', $Serial,
        'shell', 'am', 'start', '-W',
        '-a', 'android.intent.action.MAIN',
        '-c', 'android.intent.category.LAUNCHER',
        '-p', $youtubePackage
    )

    if ($launch.ExitCode -ne 0 -or (Has-RealLaunchError $launch.Output) -or -not (Wait-YouTubeForeground -Attempts 7)) {
        $monkey = Invoke-AdbCapture @(
            '-s', $Serial,
            'shell', 'monkey',
            '-p', $youtubePackage,
            '-c', 'android.intent.category.LAUNCHER',
            '1'
        )
        if ($monkey.ExitCode -ne 0 -or -not (Wait-YouTubeForeground -Attempts 10)) {
            throw "Could not launch the YouTube Android app. $($launch.Output) $($monkey.Output)"
        }
    }
}

function Convert-ToAdbInputText {
    param([string]$Text)

    # Android input text uses %s for spaces. Keep this deliberately conservative
    # so song titles cannot be interpreted as remote-shell syntax.
    $safe = $Text -replace '[^\p{L}\p{N}\s._-]', ''
    $safe = ($safe -replace '\s+', ' ').Trim()
    return ($safe -replace ' ', '%s')
}

function Invoke-InAppSearch {
    param([string]$SearchQuery)

    if (-not (Test-YouTubeForeground)) {
        Start-YouTubeHome
    }

    $ui = Get-UiXml -Attempts 8
    $searchControl = Find-SearchControl -XmlText $ui
    if ($null -eq $searchControl) {
        # YouTube sometimes hides the toolbar after a prior video. HOME inside the
        # app returns to a stable screen where the Search control is exposed.
        & $adb -s $Serial shell input keyevent KEYCODE_BACK 2>$null | Out-Null
        Start-Sleep -Milliseconds 600
        $ui = Get-UiXml -Attempts 8
        $searchControl = Find-SearchControl -XmlText $ui
    }

    if ($null -eq $searchControl) {
        throw "YouTube is open, but Jazz could not find the in-app Search control."
    }

    & $adb -s $Serial shell input tap $searchControl.X $searchControl.Y | Out-Null
    Start-Sleep -Milliseconds 850

    # If Search opened a page with a dedicated EditText, focus it explicitly.
    $searchUi = Get-UiXml -Attempts 5
    $edit = Find-SearchControl -XmlText $searchUi
    if ($null -ne $edit -and $edit.Class -match 'EditText') {
        & $adb -s $Serial shell input tap $edit.X $edit.Y | Out-Null
        Start-Sleep -Milliseconds 250
    }

    # Best-effort select-all/delete so an old YouTube query cannot be appended.
    & $adb -s $Serial shell input keycombination KEYCODE_CTRL_LEFT KEYCODE_A 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        & $adb -s $Serial shell input keyevent KEYCODE_DEL 2>$null | Out-Null
    }

    $adbText = Convert-ToAdbInputText -Text $SearchQuery
    if ([string]::IsNullOrWhiteSpace($adbText)) {
        throw "The YouTube query could not be converted to safe Android input text."
    }

    & $adb -s $Serial shell input text $adbText | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not type '$SearchQuery' into YouTube Search."
    }

    & $adb -s $Serial shell input keyevent KEYCODE_ENTER | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not submit the YouTube search for '$SearchQuery'."
    }

    Start-Sleep -Seconds 3
    if (-not (Wait-YouTubeForeground -Attempts 6)) {
        throw "YouTube lost foreground focus while searching for '$SearchQuery'."
    }
}

function Search-YouTube {
    param([string]$SearchQuery)

    $method = 'android-search-intent'
    $searchLaunch = Invoke-AdbCapture @(
        '-s', $Serial,
        'shell', 'am', 'start', '-W',
        '-a', 'android.intent.action.SEARCH',
        '-p', $youtubePackage,
        '--es', 'query', $SearchQuery
    )

    $searchIntentGood = $searchLaunch.ExitCode -eq 0 -and
        -not (Has-RealLaunchError $searchLaunch.Output) -and
        (Wait-YouTubeForeground -Attempts 8)

    if (-not $searchIntentGood) {
        Start-YouTubeHome
        Invoke-InAppSearch -SearchQuery $SearchQuery
        return 'youtube-in-app-search'
    }

    Start-Sleep -Seconds 2
    return $method
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

# Ensure the package really exists before trying to automate it.
$packagePath = (& $adb -s $Serial shell pm path $youtubePackage 2>$null | Out-String)
if ($LASTEXITCODE -ne 0 -or $packagePath -notmatch '^package:') {
    throw "The YouTube Android app ($youtubePackage) is not installed or is disabled on this device."
}

# Wake the device but never type credentials.
& $adb -s $Serial shell input keyevent KEYCODE_WAKEUP | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "ADB could not wake the Android device."
}
Start-Sleep -Milliseconds 450

$windowPolicy = (& $adb -s $Serial shell dumpsys window policy 2>$null | Out-String)
if ($windowPolicy -match '(?i)(?:isKeyguardShowing|mShowingLockscreen|mKeyguardShowing|keyguardShowing)\s*=\s*true') {
    throw "Mobile is locked. Unlock the phone first, then ask Jazz to play '$query' on YouTube."
}

# Start from a clean native YouTube task. Never use an https://youtube.com results
# deep link here: on some Android builds/YouTube versions that URI is intentionally
# handed to a browser CustomTab (Brave/Chrome), which was the source of the failure.
Start-YouTubeHome
$launchMethod = Search-YouTube -SearchQuery $query

$screen = Get-ScreenSize
$uiText = Get-UiXml -Attempts 9
$resultTarget = Find-BestResult -XmlText $uiText -SearchQuery $query -ScreenWidth $screen.Width -ScreenHeight $screen.Height

# SEARCH intent can open YouTube yet leave it on a screen that exposes too little
# accessibility text. In that case, redo the search through YouTube's own UI rather
# than falling back to a browser URL.
if ($null -eq $resultTarget -and $launchMethod -eq 'android-search-intent') {
    Start-YouTubeHome
    Invoke-InAppSearch -SearchQuery $query
    $launchMethod = 'youtube-in-app-search-after-search-intent'
    $uiText = Get-UiXml -Attempts 9
    $resultTarget = Find-BestResult -XmlText $uiText -SearchQuery $query -ScreenWidth $screen.Width -ScreenHeight $screen.Height
}

if ($null -eq $resultTarget) {
    # We are on a confirmed native YouTube results screen at this point. Use a
    # conservative first-result coordinate rather than opening any browser URL.
    $resultTarget = [pscustomobject]@{
        X      = [int]($screen.Width * 0.50)
        Y      = [int]($screen.Height * 0.34)
        Label  = "first visible YouTube result"
        Score  = 0
        Method = "native-results-coordinate-fallback"
    }
}

if (-not (Test-YouTubeForeground)) {
    throw "Jazz prepared the search, but the native YouTube app is no longer in the foreground."
}

& $adb -s $Serial shell input tap $resultTarget.X $resultTarget.Y | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Could not tap the YouTube result for '$query'."
}

Start-Sleep -Seconds 4

# If a result unexpectedly bounced to an external browser/custom tab, recover once
# by returning to native YouTube and repeating only the in-app workflow.
if (-not (Test-YouTubeForeground)) {
    & $adb -s $Serial shell input keyevent KEYCODE_BACK 2>$null | Out-Null
    Start-Sleep -Milliseconds 500
    Start-YouTubeHome
    Invoke-InAppSearch -SearchQuery $query
    $launchMethod = 'youtube-in-app-recovery'

    $uiText = Get-UiXml -Attempts 9
    $retryTarget = Find-BestResult -XmlText $uiText -SearchQuery $query -ScreenWidth $screen.Width -ScreenHeight $screen.Height
    if ($null -eq $retryTarget) {
        $retryTarget = [pscustomobject]@{
            X      = [int]($screen.Width * 0.50)
            Y      = [int]($screen.Height * 0.34)
            Label  = "first visible YouTube result"
            Score  = 0
            Method = "native-results-coordinate-recovery"
        }
    }

    & $adb -s $Serial shell input tap $retryTarget.X $retryTarget.Y | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not tap the recovered native YouTube result for '$query'."
    }
    $resultTarget = $retryTarget
    Start-Sleep -Seconds 4
}

if (-not (Test-YouTubeForeground)) {
    $snapshot = (Get-ForegroundSnapshot -replace '\s+', ' ').Trim()
    throw "The result was selected, but Android moved away from native YouTube. Foreground: $snapshot"
}

# Explicit PLAY, not a play/pause toggle.
& $adb -s $Serial shell input keyevent KEYCODE_MEDIA_PLAY | Out-Null
Start-Sleep -Milliseconds 900

$mediaSession = (& $adb -s $Serial shell dumpsys media_session 2>$null | Out-String)
$youtubeMediaSession = $mediaSession -match 'com\.google\.android\.youtube'
$playbackDetected = $youtubeMediaSession -and $mediaSession -match '(?i)(?:state\s*=\s*3|state=PlaybackState\s*\{\s*state=3)'

[pscustomobject]@{
    ok                   = $true
    message              = "youtube.ps1 executed. Opened native YouTube, searched '$query', selected the result, and requested playback."
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
