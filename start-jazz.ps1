$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$expectedVersion = "0.10.0-local"
$apiPort = 8797
$webPort = 5173
$bridgePort = 9899
$logDir = Join-Path $root ".jazz\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

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

function Show-LogTail($path, $label) {
  if (Test-Path $path) {
    $lines = @(Get-Content $path -Tail 30 -ErrorAction SilentlyContinue)
    if ($lines.Count) {
      Write-Host "---- $label ----" -ForegroundColor DarkYellow
      $lines | ForEach-Object { Write-Host $_ }
    }
  }
}

# Always remove stale Jazz runtimes first.
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
  throw "Legacy Gemini code is still present. Run repair-jazz-runtime.ps1 first."
}
Write-Host "Local Jazz API source verified: $expectedVersion" -ForegroundColor Green

# 1) Start the Jazz API FIRST. It must come online even if Ollama, Piper or ADB are unavailable.
$node = Get-Command node -ErrorAction Stop
$apiOut = Join-Path $logDir "api.out.log"
$apiErr = Join-Path $logDir "api.err.log"
Remove-Item $apiOut,$apiErr -Force -ErrorAction SilentlyContinue

$oldPort = $env:PORT
$oldProvider = $env:JAZZ_LLM_PROVIDER
$oldAutoStart = $env:JAZZ_OLLAMA_AUTOSTART
$oldFallback = $env:JAZZ_OLLAMA_FALLBACK
try {
  $env:PORT = "$apiPort"
  $env:JAZZ_LLM_PROVIDER = "ollama"
  $env:JAZZ_OLLAMA_AUTOSTART = "true"
  $env:JAZZ_OLLAMA_FALLBACK = "true"

  # Intentionally do NOT load services/api/.env here. That file may contain an old PORT/Gemini provider.
  $apiProcess = Start-Process -FilePath $node.Source -ArgumentList @($serverFile) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr -PassThru
} finally {
  if ($null -eq $oldPort) { Remove-Item Env:PORT -ErrorAction SilentlyContinue } else { $env:PORT = $oldPort }
  if ($null -eq $oldProvider) { Remove-Item Env:JAZZ_LLM_PROVIDER -ErrorAction SilentlyContinue } else { $env:JAZZ_LLM_PROVIDER = $oldProvider }
  if ($null -eq $oldAutoStart) { Remove-Item Env:JAZZ_OLLAMA_AUTOSTART -ErrorAction SilentlyContinue } else { $env:JAZZ_OLLAMA_AUTOSTART = $oldAutoStart }
  if ($null -eq $oldFallback) { Remove-Item Env:JAZZ_OLLAMA_FALLBACK -ErrorAction SilentlyContinue } else { $env:JAZZ_OLLAMA_FALLBACK = $oldFallback }
}

$healthUrl = "http://127.0.0.1:$apiPort/health"
$apiReady = $false
for ($attempt = 1; $attempt -le 24; $attempt++) {
  Start-Sleep -Milliseconds 500
  if ($apiProcess.HasExited) { break }
  if (Test-Http $healthUrl) { $apiReady = $true; break }
}

if (-not $apiReady) {
  Write-Host "Jazz API did not start on port $apiPort." -ForegroundColor Red
  Show-LogTail $apiOut "API output"
  Show-LogTail $apiErr "API errors"
  throw "Jazz API startup failed. Logs: $apiOut and $apiErr"
}

$apiHealth = Invoke-RestMethod $healthUrl -TimeoutSec 5
if ($apiHealth.version -ne $expectedVersion) {
  throw "Wrong Jazz API version. Expected $expectedVersion but got $($apiHealth.version)."
}
if ($apiHealth.provider -ne "ollama") {
  throw "Wrong provider. Expected ollama but got $($apiHealth.provider)."
}
Write-Host "Jazz API READY: version=$($apiHealth.version), provider=$($apiHealth.provider), port=$apiPort, PID=$($apiProcess.Id)" -ForegroundColor Green

# 2) Start/check Ollama. Failure here never takes the API down.
try {
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
        Write-Warning "Ollama is running but has no model. Run: ollama pull qwen2.5:7b"
      } else {
        Write-Host "Ollama ready: $($models -join ', ')" -ForegroundColor Green
      }
    }
  } else {
    Write-Warning "Ollama command not found. Local device commands still work; general AI chat needs Ollama installed."
  }
} catch {
  Write-Warning "Ollama startup check failed: $($_.Exception.Message)"
}

# 3) Start the Windows ADB bridge. Keep private device credentials only in bridges/windows-adb/.env.
try {
  $bridgeEnv = Join-Path $root "bridges\windows-adb\.env"
  $bridgeFile = Join-Path $root "bridges\windows-adb\adb-bridge.mjs"
  if (Test-Path $bridgeEnv) {
    $bridgeOut = Join-Path $logDir "bridge.out.log"
    $bridgeErr = Join-Path $logDir "bridge.err.log"
    Remove-Item $bridgeOut,$bridgeErr -Force -ErrorAction SilentlyContinue
    $bridgeProcess = Start-Process -FilePath $node.Source -ArgumentList @("--env-file=$bridgeEnv", $bridgeFile) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $bridgeOut -RedirectStandardError $bridgeErr -PassThru
    for ($attempt = 1; $attempt -le 16; $attempt++) {
      Start-Sleep -Milliseconds 350
      if (Test-Http "http://127.0.0.1:$bridgePort/health") { break }
      if ($bridgeProcess.HasExited) { break }
    }
    if (Test-Http "http://127.0.0.1:$bridgePort/health") {
      Write-Host "ADB bridge READY on port $bridgePort, PID=$($bridgeProcess.Id)" -ForegroundColor Green
    } else {
      Write-Warning "ADB bridge did not become ready. Device commands will fail until it is fixed."
      Show-LogTail $bridgeErr "ADB bridge errors"
    }
  } else {
    Write-Warning "ADB bridge .env is missing: $bridgeEnv"
  }
} catch {
  Write-Warning "ADB bridge startup failed: $($_.Exception.Message)"
}

# 4) Piper is optional for API availability. Install it if possible, but never abort Jazz startup.
try {
  $piperExe = Join-Path $root "tools\piper\piper.exe"
  $piperSetup = Join-Path $root "tools\piper\setup-windows.ps1"
  if (-not (Test-Path $piperExe) -and (Test-Path $piperSetup)) {
    Write-Host "Piper is missing. Installing Piper + Amy voice..." -ForegroundColor Yellow
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $piperSetup
    if ($LASTEXITCODE -ne 0) { Write-Warning "Piper installer exited with code $LASTEXITCODE." }
  }
  if (Test-Path $piperExe) { Write-Host "Piper ready." -ForegroundColor Green }
  else { Write-Warning "Piper is unavailable. Browser TTS fallback will be used." }
} catch {
  Write-Warning "Piper setup failed, but Jazz API remains online: $($_.Exception.Message)"
}

# 5) Start the web UI after the API is confirmed alive.
try {
  $webCommand = "Set-Location '$root\apps\web'; `$env:JAZZ_API_PORT='$apiPort'; if (Test-Path '.\node_modules\.vite') { Remove-Item -Recurse -Force '.\node_modules\.vite' -ErrorAction SilentlyContinue }; pnpm dev -- --force --port $webPort --strictPort"
  Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", $webCommand
  Start-Sleep -Seconds 2
} catch {
  Write-Warning "Web UI startup failed: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "Jazz health:" -ForegroundColor Cyan
(Invoke-RestMethod $healthUrl -TimeoutSec 5) | ConvertTo-Json -Depth 6
Write-Host ""
Write-Host "Jazz startup completed." -ForegroundColor Green
Write-Host "Web: http://localhost:$webPort/?v=20260918-6" -ForegroundColor Green
Write-Host "API: http://127.0.0.1:$apiPort/health" -ForegroundColor Green
Write-Host "API logs: $apiOut ; $apiErr" -ForegroundColor DarkGray
