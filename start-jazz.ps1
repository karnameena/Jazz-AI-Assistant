$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "Jazz startup" -ForegroundColor Cyan
Write-Host "Root: $root"

function Test-Http($url) {
  try {
    Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 2 | Out-Null
    return $true
  } catch { return $false }
}

# 1) Ollama local brain
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if ($ollama) {
  if (-not (Test-Http "http://127.0.0.1:11434/api/tags")) {
    Write-Host "Starting Ollama local brain..." -ForegroundColor Cyan
    Start-Process -FilePath $ollama.Source -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 2
  }
  if (Test-Http "http://127.0.0.1:11434/api/tags") {
    $tags = Invoke-RestMethod "http://127.0.0.1:11434/api/tags"
    $models = @($tags.models | ForEach-Object { $_.name })
    if ($models.Count -eq 0) {
      Write-Warning "Ollama is running but no model is installed. Run: ollama pull qwen2.5:7b"
    } else {
      Write-Host "Ollama ready: $($models -join ', ')" -ForegroundColor Green
    }
  }
} else {
  Write-Warning "Ollama command not found. Jazz will still handle local commands, but general AI chat needs Ollama or an online provider."
}

# 2) Piper TTS. Set it up automatically only when missing.
$piperExe = Join-Path $root "tools\piper\piper.exe"
$piperSetup = Join-Path $root "tools\piper\setup-windows.ps1"
if (-not (Test-Path $piperExe)) {
  if (Test-Path $piperSetup) {
    Write-Host "Piper is missing. Installing the free local Piper runtime and Amy voice..." -ForegroundColor Yellow
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $piperSetup
  }
}
if (Test-Path $piperExe) { Write-Host "Piper ready." -ForegroundColor Green }
else { Write-Warning "Piper is still missing. Browser TTS fallback will be used." }

# 3) Windows ADB bridge
$bridgeEnv = Join-Path $root "bridges\windows-adb\.env"
$bridgeJs = Join-Path $root "bridges\windows-adb\adb-bridge.mjs"
if (-not (Test-Http "http://127.0.0.1:9899/health")) {
  if (-not (Test-Path $bridgeEnv)) { Write-Warning "ADB bridge .env is missing: $bridgeEnv" }
  else {
    $bridgeCommand = "Set-Location '$root'; node --env-file='.\bridges\windows-adb\.env' '.\bridges\windows-adb\adb-bridge.mjs'"
    Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", $bridgeCommand
    Start-Sleep -Seconds 1
  }
}

# 4) Jazz API
$apiEnv = Join-Path $root "services\api\.env"
if (-not (Test-Http "http://127.0.0.1:8787/health")) {
  $envArg = if (Test-Path $apiEnv) { "--env-file='.\services\api\.env'" } else { "" }
  $apiCommand = "Set-Location '$root'; node $envArg '.\services\api\src\server.mjs'"
  Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", $apiCommand
  Start-Sleep -Seconds 2
}

# 5) Web UI
$webCommand = "Set-Location '$root\apps\web'; if (Test-Path '.\node_modules\.vite') { Remove-Item -Recurse -Force '.\node_modules\.vite' -ErrorAction SilentlyContinue }; pnpm dev -- --force"
Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", $webCommand

Start-Sleep -Seconds 2
Write-Host ""
Write-Host "Jazz health:" -ForegroundColor Cyan
try {
  $health = Invoke-RestMethod "http://127.0.0.1:8787/health" -TimeoutSec 5
  $health | ConvertTo-Json -Depth 6
} catch {
  Write-Warning "Jazz API health check failed: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "Jazz startup completed. Open the Vite URL shown in the web terminal." -ForegroundColor Green
