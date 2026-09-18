$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$expectedVersion = "0.10.0-local"
$apiPort = 8797
$webPort = 5173
$bridgePort = 9899

Write-Host "Jazz startup" -ForegroundColor Cyan
Write-Host "Root: $root"
Write-Host "API port: $apiPort"

function Test-Http($url) {
  try {
    Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 2 | Out-Null
    return $true
  } catch { return $false }
}

function Stop-PortListener([int]$port) {
  try {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in @($connections)) {
      if ($connection.OwningProcess) {
        Write-Host "Stopping stale listener on port $port (PID $($connection.OwningProcess))..." -ForegroundColor DarkYellow
        Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {}
}

function Stop-StaleJazzNodeProcesses {
  try {
    $needle = [regex]::Escape($root)
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -match '^node(\.exe)?$' -and
        $_.CommandLine -match $needle -and
        ($_.CommandLine -match 'server\.mjs' -or $_.CommandLine -match 'adb-bridge\.mjs' -or $_.CommandLine -match 'vite')
      } |
      ForEach-Object {
        Write-Host "Stopping stale Jazz Node process PID $($_.ProcessId)..." -ForegroundColor DarkYellow
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      }
  } catch {}
}

# Kill old Jazz processes first. Port 8787 is retired so old API code cannot answer the web app.
Stop-StaleJazzNodeProcesses
Stop-PortListener 8787
Stop-PortListener $apiPort
Stop-PortListener $bridgePort
Stop-PortListener $webPort
Start-Sleep -Milliseconds 600

# Refuse to boot an old checkout.
$serverFile = Join-Path $root "services\api\src\server.mjs"
$serverText = Get-Content $serverFile -Raw
if ($serverText -notmatch [regex]::Escape("const VERSION = `"$expectedVersion`"")) {
  throw "This local server.mjs is not the current Jazz API. Run repair-jazz-runtime.ps1 first."
}
if ($serverText -match "I tried the configured model and resilient fallbacks") {
  throw "Old Gemini fallback text is still present in this checkout. Run repair-jazz-runtime.ps1 first."
}
Write-Host "Local Jazz API source verified: $expectedVersion" -ForegroundColor Green

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
  Write-Warning "Ollama command not found. Local device commands still work; general AI chat needs Ollama installed."
}

# 2) Piper TTS. Install automatically when missing.
$piperExe = Join-Path $root "tools\piper\piper.exe"
$piperSetup = Join-Path $root "tools\piper\setup-windows.ps1"
if (-not (Test-Path $piperExe) -and (Test-Path $piperSetup)) {
  Write-Host "Piper is missing. Installing Piper + Amy voice..." -ForegroundColor Yellow
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $piperSetup
}
if (Test-Path $piperExe) { Write-Host "Piper ready." -ForegroundColor Green }
else { Write-Warning "Piper is unavailable. Browser TTS fallback will be used." }

# 3) Windows ADB bridge
$bridgeEnv = Join-Path $root "bridges\windows-adb\.env"
if (Test-Path $bridgeEnv) {
  $bridgeCommand = "Set-Location '$root'; node --env-file='.\bridges\windows-adb\.env' '.\bridges\windows-adb\adb-bridge.mjs'"
  Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", $bridgeCommand
  Start-Sleep -Seconds 1
} else {
  Write-Warning "ADB bridge .env is missing: $bridgeEnv"
}

# 4) Jazz API — force local Ollama and isolated port 8797 even if services/api/.env says Gemini/8787.
$apiEnv = Join-Path $root "services\api\.env"
$envArg = if (Test-Path $apiEnv) { "--env-file='.\services\api\.env'" } else { "" }
$apiCommand = "Set-Location '$root'; `$env:PORT='$apiPort'; `$env:JAZZ_LLM_PROVIDER='ollama'; `$env:JAZZ_OLLAMA_AUTOSTART='true'; `$env:JAZZ_OLLAMA_FALLBACK='true'; node $envArg '.\services\api\src\server.mjs'"
Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", $apiCommand
Start-Sleep -Seconds 2

$healthUrl = "http://127.0.0.1:$apiPort/health"
try {
  $apiHealth = Invoke-RestMethod $healthUrl -TimeoutSec 5
  if ($apiHealth.version -ne $expectedVersion) {
    throw "Wrong Jazz API version. Expected $expectedVersion but got $($apiHealth.version)."
  }
  if ($apiHealth.provider -ne "ollama") {
    throw "Wrong provider. Expected ollama but got $($apiHealth.provider)."
  }
  Write-Host "Jazz API verified: version=$($apiHealth.version), provider=$($apiHealth.provider), port=$apiPort" -ForegroundColor Green
} catch {
  throw "Jazz API verification failed: $($_.Exception.Message)"
}

# 5) Web UI — fixed port and fixed API target.
$webCommand = "Set-Location '$root\apps\web'; `$env:JAZZ_API_PORT='$apiPort'; if (Test-Path '.\node_modules\.vite') { Remove-Item -Recurse -Force '.\node_modules\.vite' -ErrorAction SilentlyContinue }; pnpm dev -- --force --port $webPort --strictPort"
Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", $webCommand
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Jazz health:" -ForegroundColor Cyan
(Invoke-RestMethod $healthUrl -TimeoutSec 5) | ConvertTo-Json -Depth 6
Write-Host ""
Write-Host "Jazz startup completed. Open http://localhost:$webPort" -ForegroundColor Green
Write-Host "Old API port 8787 is retired. The website now talks only to API port $apiPort." -ForegroundColor Green
