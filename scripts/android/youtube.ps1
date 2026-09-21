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

$query = $query `
    -replace '(?i)\s+(?:on|in)\s+youtube(?:\s+music)?\s*$', '' `
    -replace '(?i)\s+(?:on|in)\s+(?:my\s+)?(?:mobile|phone|tablet)\s*$', '' `
    -replace '(?i)\s+(?:please|jazz)\s*$', ''
$query = $query.Trim()

if ([string]::IsNullOrWhiteSpace($query)) {
    throw "youtube.ps1 received an empty YouTube query."
}

# Wake the screen, then ask the installed YouTube app to show search results.
& $adb -s $Serial shell input keyevent KEYCODE_WAKEUP | Out-Null
Start-Sleep -Milliseconds 500

$searchArgs = @(
    '-s', $Serial,
    'shell', 'am', 'start', '-W',
    '-a', 'android.intent.action.SEARCH',
    '-p', 'com.google.android.youtube',
    '--es', 'query', $query
)

& $adb @searchArgs | Out-Null
$searchExit = $LASTEXITCODE

if ($searchExit -ne 0) {
    $encoded = [uri]::EscapeDataString($query)
    $url = "https://www.youtube.com/results?search_query=$encoded"
    & $adb -s $Serial shell am start -W -a android.intent.action.VIEW -d $url -p com.google.android.youtube | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not open the YouTube search results."
    }
}

# Give YouTube time to render, then open the first visible result. Coordinates are
# calculated from the real device resolution instead of being hard-coded.
Start-Sleep -Seconds 4

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

$x = [int]($width * 0.50)
$y = [int]($height * 0.31)

& $adb -s $Serial shell input tap $x $y | Out-Null
Start-Sleep -Seconds 2

# Use PLAY (not PLAY_PAUSE), so an already-opened video is asked to play rather than toggled off.
& $adb -s $Serial shell input keyevent KEYCODE_MEDIA_PLAY | Out-Null

[pscustomobject]@{
    ok             = $true
    message        = "youtube.ps1 executed. Playing '$query' on YouTube."
    query          = $query
    script         = "youtube.ps1"
    executedScript = $true
} | ConvertTo-Json -Compress
