$ErrorActionPreference = "Stop"

function Get-JazzRequest {
    if ([string]::IsNullOrWhiteSpace($env:JAZZ_SCRIPT_ARGS)) { return "" }
    try {
        $payload = $env:JAZZ_SCRIPT_ARGS | ConvertFrom-Json
        if (-not [string]::IsNullOrWhiteSpace([string]$payload.query)) {
            return "play $([string]$payload.query)"
        }
        return [string]$payload.request
    } catch {
        return ""
    }
}

function Get-YouTubeQuery([string]$request) {
    $text = ([string]$request).Trim()
    if ([string]::IsNullOrWhiteSpace($text)) { return "" }

    $text = $text -replace '^(?i)\s*(?:hey\s+)?jazz\s*[,!:;-]*\s*', ''

    $patterns = @(
        '(?i)\b(?:open\s+)?youtube\b.*?\bplay\b\s+(.+?)\s*$',
        '(?i)\bplay\b\s+(.+?)\s+(?:on|in)\s+youtube\b.*$',
        '(?i)^\s*play\s+(.+?)\s*$'
    )

    foreach ($pattern in $patterns) {
        $match = [regex]::Match($text, $pattern)
        if ($match.Success) {
            $query = $match.Groups[1].Value.Trim()
            $query = $query -replace '(?i)\s+(?:please|for me|jazz)\s*$', ''
            $query = $query.Trim(' ', '"', "'", '.', ',', '!', '?')
            if (-not [string]::IsNullOrWhiteSpace($query)) { return $query }
        }
    }

    return ""
}

function Find-Brave {
    $candidates = @(
        "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
        "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe"
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }

    $command = Get-Command brave.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    throw "Brave browser is not installed or could not be found."
}

function Resolve-FirstYouTubeVideo([string]$query) {
    $encoded = [uri]::EscapeDataString($query)
    $searchUrl = "https://www.youtube.com/results?search_query=$encoded"

    try {
        $headers = @{
            "User-Agent"      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"
            "Accept-Language" = "en-US,en;q=0.9"
        }
        $response = Invoke-WebRequest -UseBasicParsing -Uri $searchUrl -Headers $headers -TimeoutSec 15
        $html = [string]$response.Content

        # YouTube embeds search result video IDs in the initial page JSON.
        $matches = [regex]::Matches($html, '"videoId":"([A-Za-z0-9_-]{11})"')
        foreach ($match in $matches) {
            $videoId = $match.Groups[1].Value
            if (-not [string]::IsNullOrWhiteSpace($videoId)) {
                return [pscustomobject]@{
                    Resolved = $true
                    Url      = "https://www.youtube.com/watch?v=$videoId&autoplay=1"
                }
            }
        }
    } catch {
        # Continue to yt-dlp / search fallback below.
    }

    # If yt-dlp is already installed, use it as a second resolver. No installation
    # is attempted here; Jazz stays local and uses only what is already available.
    try {
        $ytDlp = Get-Command yt-dlp.exe -ErrorAction SilentlyContinue
        if (-not $ytDlp) { $ytDlp = Get-Command yt-dlp -ErrorAction SilentlyContinue }
        if ($ytDlp) {
            $videoId = (& $ytDlp.Source "ytsearch1:$query" --get-id --skip-download --no-playlist 2>$null | Select-Object -First 1)
            $videoId = ([string]$videoId).Trim()
            if ($videoId -match '^[A-Za-z0-9_-]{11}$') {
                return [pscustomobject]@{
                    Resolved = $true
                    Url      = "https://www.youtube.com/watch?v=$videoId&autoplay=1"
                }
            }
        }
    } catch {}

    return [pscustomobject]@{
        Resolved = $false
        Url      = $searchUrl
    }
}

$request = Get-JazzRequest
$query = Get-YouTubeQuery $request
if ([string]::IsNullOrWhiteSpace($query)) {
    throw "I couldn't determine which song or video to play."
}

$brave = Find-Brave
$target = Resolve-FirstYouTubeVideo $query

Start-Process -FilePath $brave -ArgumentList @("--new-tab", $target.Url)
Start-Sleep -Milliseconds 500

$message = if ($target.Resolved) {
    "Playing '$query' on YouTube in Brave."
} else {
    "Opened YouTube in Brave and searched for '$query'."
}

[pscustomobject]@{
    ok             = $true
    message        = $message
    query          = $query
    browser        = "Brave"
    resolvedVideo  = [bool]$target.Resolved
    executedScript = $true
} | ConvertTo-Json -Compress
