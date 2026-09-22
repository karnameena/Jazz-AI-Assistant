$ErrorActionPreference = "Stop"

$toolRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeDir = Join-Path $toolRoot "runtime"
$modelDir = Join-Path $toolRoot "models"
$cliPath = Join-Path $runtimeDir "whisper-cli.exe"
$modelPath = Join-Path $modelDir "ggml-base.en-q5_1.bin"
$stage = Join-Path $env:TEMP "jazz-whisper-stage"
$archive = Join-Path $stage "whisper-bin-x64.zip"

New-Item -ItemType Directory -Force -Path $runtimeDir,$modelDir | Out-Null

function Download-File([string]$Url, [string]$OutFile) {
    Write-Host "Downloading $Url" -ForegroundColor Cyan
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile
    if (-not (Test-Path $OutFile) -or (Get-Item $OutFile).Length -lt 1024) {
        throw "Download failed or returned an invalid file: $Url"
    }
}

if (-not (Test-Path $cliPath)) {
    Write-Host "Installing local Whisper.cpp runtime for Jazz STT..." -ForegroundColor Cyan
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $stage | Out-Null

    $headers = @{ "User-Agent" = "Jazz-AI-Assistant" }
    $releases = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=20"
    $asset = $null
    foreach ($release in @($releases)) {
        $candidate = @($release.assets | Where-Object { $_.name -eq "whisper-bin-x64.zip" }) | Select-Object -First 1
        if ($candidate) { $asset = $candidate; break }
    }
    if (-not $asset) {
        throw "Could not find the official whisper-bin-x64.zip release asset."
    }

    Download-File $asset.browser_download_url $archive
    $extractDir = Join-Path $stage "extract"
    Expand-Archive -Path $archive -DestinationPath $extractDir -Force

    $foundCli = Get-ChildItem $extractDir -Recurse -Filter "whisper-cli.exe" -File | Select-Object -First 1
    if (-not $foundCli) { throw "whisper-cli.exe was not found in the downloaded runtime." }

    $sourceDir = Split-Path -Parent $foundCli.FullName
    Remove-Item $runtimeDir -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    Copy-Item (Join-Path $sourceDir "*") $runtimeDir -Recurse -Force
}

if (-not (Test-Path $modelPath)) {
    Write-Host "Downloading local English speech model (base.en q5_1)..." -ForegroundColor Cyan
    $modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin?download=true"
    $tempModel = "$modelPath.download"
    Remove-Item $tempModel -Force -ErrorAction SilentlyContinue
    Download-File $modelUrl $tempModel
    Move-Item $tempModel $modelPath -Force
}

if (-not (Test-Path $cliPath)) { throw "Whisper CLI is still missing: $cliPath" }
if (-not (Test-Path $modelPath)) { throw "Whisper model is still missing: $modelPath" }

$helpOut = Join-Path $stage "whisper-help.out.txt"
$helpErr = Join-Path $stage "whisper-help.err.txt"
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Remove-Item $helpOut,$helpErr -Force -ErrorAction SilentlyContinue
$process = Start-Process -FilePath $cliPath -ArgumentList @("--help") -WorkingDirectory $runtimeDir -WindowStyle Hidden -RedirectStandardOutput $helpOut -RedirectStandardError $helpErr -PassThru -Wait
if ($process.ExitCode -ne 0) {
    $detail = ((Get-Content $helpErr -Raw -ErrorAction SilentlyContinue) + " " + (Get-Content $helpOut -Raw -ErrorAction SilentlyContinue)).Trim()
    throw "Whisper runtime smoke test failed with exit code $($process.ExitCode). $detail"
}

$dllCount = @(Get-ChildItem $runtimeDir -Filter "*.dll" -File -ErrorAction SilentlyContinue).Count
Write-Host "Jazz local speech-to-text is ready." -ForegroundColor Green
Write-Host "Whisper CLI : $cliPath" -ForegroundColor Green
Write-Host "Runtime DLLs: $dllCount" -ForegroundColor Green
Write-Host "Model       : $modelPath" -ForegroundColor Green
