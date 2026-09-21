param(
    [string]$Serial = $env:JAZZ_ANDROID_SERIAL
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Serial)) {
    throw "JAZZ_ANDROID_SERIAL is not available to youtube.ps1."
}

$adb = if ($env:ADB_PATH) { $env:ADB_PATH } else { "adb" }
$youtubePackage = "com.google.android.youtube"

function Invoke-Adb {
    param(
        [string[]]$Arguments,
        [switch]$IgnoreFailure
    )

    $oldPreference = $ErrorActionPreference
    try {
        # Native tools such as adb/uiautomator can write harmless status text to
        # stderr. Keep that from becoming a terminating PowerShell error.
        $ErrorActionPreference = "Continue"
        $output = (& $adb @Arguments 2>&1 | Out-String).Trim()
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $oldPreference
    }

    if (-not $IgnoreFailure -and $exitCode -ne 0) {
        throw "adb.exe failed (exit $exitCode): $output"
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $output
    }
}

function Test-YouTubeForeground {
    $window = (Invoke-Adb -Arguments @(
        '-s', $Serial,
        'shell', 'dumpsys', 'window', 'windows'
    ) -IgnoreFailure).Output

    $activity = (Invoke-Adb -Arguments @(
        '-s', $Serial,
        'shell', 'dumpsys', 'activity', 'activities'
    ) -IgnoreFailure).Output

    return "$window`n$activity" -match 'com\.google\.android\.youtube'
}

function Wait-YouTubeForeground {
    param([int]$Attempts = 14, [int]$DelayMs = 450)

    for ($i = 0; $i -lt $Attempts; $i++) {
        if (Test-YouTubeForeground) { return $true }
        Start-Sleep -Milliseconds $DelayMs
    }
    return $false
}

function Get-ScreenSize {
    $sizeText = (Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'wm', 'size') -IgnoreFailure).Output
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

function Start-YouTubeSearch {
    param([string]$SearchQuery)

    # Use YouTube's native Android SEARCH intent. This avoids UiAutomator entirely,
    # which can return "null root node" on some Android 15/YouTube combinations.
    $search = Invoke-Adb -Arguments @(
        '-s', $Serial,
        'shell', 'am', 'start', '-W',
        '-a', 'android.intent.action.SEARCH',
        '-p', $youtubePackage,
        '--es', 'query', $SearchQuery
    ) -IgnoreFailure

    if ($search.ExitCode -eq 0 -and (Wait-YouTubeForeground -Attempts 12)) {
        return 'android-search-intent'
    }

    # Fallback: launch YouTube home first, then send the same SEARCH intent again.
    Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'am', 'force-stop', $youtubePackage) -IgnoreFailure | Out-Null
    Start-Sleep -Milliseconds 350

    $launch = Invoke-Adb -Arguments @(
        '-s', $Serial,
        'shell', 'monkey',
        '-p', $youtubePackage,
        '-c', 'android.intent.category.LAUNCHER',
        '1'
    ) -IgnoreFailure

    if ($launch.ExitCode -ne 0 -or -not (Wait-YouTubeForeground -Attempts 12)) {
        throw "Could not launch the native YouTube app. $($launch.Output)"
    }

    $search = Invoke-Adb -Arguments @(
        '-s', $Serial,
        'shell', 'am', 'start', '-W',
        '-a', 'android.intent.action.SEARCH',
        '-p', $youtubePackage,
        '--es', 'query', $SearchQuery
    ) -IgnoreFailure

    if ($search.ExitCode -ne 0 -or -not (Wait-YouTubeForeground -Attempts 12)) {
        throw "YouTube opened, but the native search for '$SearchQuery' failed. $($search.Output)"
    }

    return 'youtube-launch-then-search-intent'
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

$packagePath = (Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'pm', 'path', $youtubePackage) -IgnoreFailure).Output
if ($packagePath -notmatch 'package:') {
    throw "The YouTube Android app ($youtubePackage) is not installed or is disabled on this device."
}

Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP') | Out-Null
Start-Sleep -Milliseconds 500

$windowPolicy = (Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'dumpsys', 'window', 'policy') -IgnoreFailure).Output
if ($windowPolicy -match '(?i)(?:isKeyguardShowing|mShowingLockscreen|mKeyguardShowing|keyguardShowing)\s*=\s*true') {
    throw "Mobile is locked. Unlock the phone first, then ask Jazz to play '$query' on YouTube."
}

$launchMethod = Start-YouTubeSearch -SearchQuery $query
Start-Sleep -Seconds 3

if (-not (Test-YouTubeForeground)) {
    throw "YouTube search opened, but the native YouTube app is no longer in the foreground."
}

# No UiAutomator dependency. Tap the first visible native search result using the
# same safe coordinate fallback the previous workflow already used.
$screen = Get-ScreenSize
$tapX = [int]($screen.Width * 0.50)
$tapY = [int]($screen.Height * 0.34)

Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'input', 'tap', "$tapX", "$tapY") | Out-Null
Start-Sleep -Seconds 4

if (-not (Test-YouTubeForeground)) {
    throw "Jazz searched for '$query', but Android moved away from the native YouTube app after selecting the result."
}

# If the selected result is paused/preloaded, request media playback.
Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PLAY') -IgnoreFailure | Out-Null
Start-Sleep -Milliseconds 900

$mediaSession = (Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'dumpsys', 'media_session') -IgnoreFailure).Output
$youtubeMediaSession = $mediaSession -match 'com\.google\.android\.youtube'
$playbackDetected = $youtubeMediaSession -and $mediaSession -match '(?i)(?:state\s*=\s*3|state=PlaybackState\s*\{\s*state=3)'

[pscustomobject]@{
    ok                  = $true
    message             = "youtube.ps1 executed. Opened native YouTube, searched '$query', selected the first result, and requested playback."
    query               = $query
    serial              = $Serial
    launchMethod        = $launchMethod
    tapX                = $tapX
    tapY                = $tapY
    matchMethod         = "native-results-coordinate-no-uiautomator"
    youtubeMediaSession = $youtubeMediaSession
    playbackDetected    = $playbackDetected
    script              = "youtube.ps1"
    executedScript      = $true
} | ConvertTo-Json -Compress
