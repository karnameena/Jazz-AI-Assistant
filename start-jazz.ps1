$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$apiPort = 8797
$sttPort = 8798
$recoveryPort = 8799
$webPort = 5173
$bridgePort = 9899
$logDir = Join-Path $root ".jazz\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Write-Host "Jazz startup" -ForegroundColor Cyan
Write-Host "Root: $root"
Write-Host "API port: $apiPort"
Write-Host "Local STT port: $sttPort"
Write-Host "Recovery proxy port: $recoveryPort"

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
        ($_.CommandLine -match 'server\.mjs' -or $_.CommandLine -match 'adb-bridge\.mjs' -or $_.CommandLine -match 'services\\stt' -or $_.CommandLine -match 'services\\recovery-local' -or $_.CommandLine -match 'vite')
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

function Test-JazzPiperApi {
  param([int]$Port)
  $body = @{ text = "Jazz ready." } | ConvertTo-Json
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/tts" -Method POST -ContentType "application/json" -Body $body -TimeoutSec 30
    return $response.StatusCode -eq 200 -and $response.RawContentLength -gt 44
  } catch {
    return $false
  }
}

# Always remove stale Jazz runtimes first.
Stop-StaleJazzNodeProcesses
Stop-PortListener 8787
Stop-PortListener $apiPort
Stop-PortListener $sttPort
Stop-PortListener $recoveryPort
Stop-PortListener $bridgePort
Stop-PortListener $webPort
Start-Sleep -Milliseconds 600

# Verify the checked-out API by its current source version and required integration points.
# Do not hard-code a specific release here: that made a valid newer API look stale.
$serverFile = Join-Path $root "services\api\src\server.mjs"
if (-not (Test-Path $serverFile)) {
  throw "Jazz API source is missing: $serverFile"
}
$serverText = Get-Content $serverFile -Raw
$versionMatch = [regex]::Match($serverText, 'const\s+VERSION\s*=\s*"(?<version>\d+\.\d+\.\d+-local)"')
if (-not $versionMatch.Success) {
  throw "Jazz API source does not expose a valid VERSION. Pull the current repository and retry."
}
$expectedVersion = $versionMatch.Groups['version'].Value
if ($serverText -match "I tried the configured model and resilient fallbacks") {
  throw "Legacy Gemini code is still present. Run repair-jazz-runtime.ps1 first."
}
if ($serverText -notmatch 'utterance-normalizer\.mjs' -or $serverText -notmatch 'normalizeUtterance') {
  throw "Jazz API understanding integration is missing. Run repair-jazz-runtime.ps1 first."
}
Write-Host "Local Jazz API source verified: $expectedVersion" -ForegroundColor Green

# 1) Start API first. Piper prewarm is disabled until the launcher validates the runtime.
$node = Get-Command node -ErrorAction Stop
$apiOut = Join-Path $logDir "api.out.log"
$apiErr = Join-Path $logDir "api.err.log"
Remove-Item $apiOut,$apiErr -Force -ErrorAction SilentlyContinue

$oldPort = $env:PORT
$oldProvider = $env:JAZZ_LLM_PROVIDER
$oldAutoStart = $env:JAZZ_OLLAMA_AUTOSTART
$oldFallback = $env:JAZZ_OLLAMA_FALLBACK
$oldPiperPrewarm = $env:JAZZ_PIPER_PREWARM
try {
  $env:PORT = "$apiPort"
  $env:JAZZ_LLM_PROVIDER = "ollama"
  $env:JAZZ_OLLAMA_AUTOSTART = "true"
  $env:JAZZ_OLLAMA_FALLBACK = "true"
  $env:JAZZ_PIPER_PREWARM = "false"

  # Do not load services/api/.env here. Old provider/Piper overrides in that file
  # must not control the managed Jazz runtime.
  $apiProcess = Start-Process -FilePath $node.Source -ArgumentList @($serverFile) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr -PassThru
} finally {
  if ($null -eq $oldPort) { Remove-Item Env:PORT -ErrorAction SilentlyContinue } else { $env:PORT = $oldPort }
  if ($null -eq $oldProvider) { Remove-Item Env:JAZZ_LLM_PROVIDER -ErrorAction SilentlyContinue } else { $env:JAZZ_LLM_PROVIDER = $oldProvider }
  if ($null -eq $oldAutoStart) { Remove-Item Env:JAZZ_OLLAMA_AUTOSTART -ErrorAction SilentlyContinue } else { $env:JAZZ_OLLAMA_AUTOSTART = $oldAutoStart }
  if ($null -eq $oldFallback) { Remove-Item Env:JAZZ_OLLAMA_FALLBACK -ErrorAction SilentlyContinue } else { $env:JAZZ_OLLAMA_FALLBACK = $oldFallback }
  if ($null -eq $oldPiperPrewarm) { Remove-Item Env:JAZZ_PIPER_PREWARM -ErrorAction SilentlyContinue } else { $env:JAZZ_PIPER_PREWARM = $oldPiperPrewarm }
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
  throw "Wrong Jazz API runtime. Source expects $expectedVersion but health endpoint reports $($apiHealth.version)."
}
if ($apiHealth.provider -ne "ollama") {
  throw "Wrong provider. Expected ollama but got $($apiHealth.provider)."
}
Write-Host "Jazz API READY: version=$($apiHealth.version), provider=$($apiHealth.provider), port=$apiPort, PID=$($apiProcess.Id)" -ForegroundColor Green

# 2) Ollama local brain.
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
        Write-Warning "Ollama is running but has no model. Run: ollama pull qwen3:8b"
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

# 3) Local Whisper speech-to-text. This is Jazz's primary microphone engine and
# does not depend on Chrome/Edge cloud speech services.
$sttOut = Join-Path $logDir "stt.out.log"
$sttErr = Join-Path $logDir "stt.err.log"
try {
  $sttSetup = Join-Path $root "tools\whisper\setup-windows.ps1"
  $sttCli = Join-Path $root "tools\whisper\runtime\whisper-cli.exe"
  $sttModel = Join-Path $root "tools\whisper\models\ggml-base.en-q5_1.bin"
  $sttServer = Join-Path $root "services\stt\server.mjs"

  if (-not (Test-Path $sttCli) -or -not (Test-Path $sttModel)) {
    if (-not (Test-Path $sttSetup)) { throw "Whisper setup script is missing: $sttSetup" }
    Write-Host "Installing Jazz local speech-to-text..." -ForegroundColor Yellow
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $sttSetup
    if ($LASTEXITCODE -ne 0) { throw "Whisper setup exited with code $LASTEXITCODE." }
  }

  if (-not (Test-Path $sttServer)) { throw "Jazz STT server is missing: $sttServer" }
  Remove-Item $sttOut,$sttErr -Force -ErrorAction SilentlyContinue
  $oldSttPort = $env:JAZZ_STT_PORT
  try {
    $env:JAZZ_STT_PORT = "$sttPort"
    $sttProcess = Start-Process -FilePath $node.Source -ArgumentList @($sttServer) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $sttOut -RedirectStandardError $sttErr -PassThru
  } finally {
    if ($null -eq $oldSttPort) { Remove-Item Env:JAZZ_STT_PORT -ErrorAction SilentlyContinue } else { $env:JAZZ_STT_PORT = $oldSttPort }
  }

  $sttHealthUrl = "http://127.0.0.1:$sttPort/health"
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    Start-Sleep -Milliseconds 300
    if (Test-Http $sttHealthUrl) { break }
    if ($sttProcess.HasExited) { break }
  }

  if (-not (Test-Http $sttHealthUrl)) {
    Show-LogTail $sttErr "Local STT errors"
    throw "Local STT service did not become ready."
  }

  $sttHealth = Invoke-RestMethod $sttHealthUrl -TimeoutSec 5
  if (-not $sttHealth.ok) {
    throw "Local STT service started but Whisper is incomplete."
  }
  Write-Host "Local Whisper STT READY on port $sttPort, PID=$($sttProcess.Id)" -ForegroundColor Green
} catch {
  Write-Warning "Local Whisper STT is not ready; browser recognition will remain as fallback: $($_.Exception.Message)"
}

# 4) Windows ADB bridge. Existing local control flow is unchanged.
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

# 5) Dedicated local recovery proxy. It is intentionally isolated from the ADB,
# PowerShell script, Accessibility, Ollama and normal Android-command paths.
$recoveryOut = Join-Path $logDir "recovery.out.log"
$recoveryErr = Join-Path $logDir "recovery.err.log"
try {
  $recoveryServer = Join-Path $root "services\recovery-local\server.mjs"
  $recoveryEnv = Join-Path $root "services\recovery-local\.env"
  if (-not (Test-Path $recoveryServer)) { throw "Recovery proxy server is missing: $recoveryServer" }
  Remove-Item $recoveryOut,$recoveryErr -Force -ErrorAction SilentlyContinue
  $recoveryArgs = @()
  if (Test-Path $recoveryEnv) { $recoveryArgs += "--env-file=$recoveryEnv" }
  $recoveryArgs += $recoveryServer
  $recoveryProcess = Start-Process -FilePath $node.Source -ArgumentList $recoveryArgs -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $recoveryOut -RedirectStandardError $recoveryErr -PassThru
  for ($attempt = 1; $attempt -le 16; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Test-Http "http://127.0.0.1:$recoveryPort/health") { break }
    if ($recoveryProcess.HasExited) { break }
  }
  if (Test-Http "http://127.0.0.1:$recoveryPort/health") {
    $recoveryHealth = Invoke-RestMethod "http://127.0.0.1:$recoveryPort/health" -TimeoutSec 3
    Write-Host "Recovery proxy READY on port $recoveryPort, configured=$($recoveryHealth.configured), PID=$($recoveryProcess.Id)" -ForegroundColor Green
    if (-not $recoveryHealth.configured) {
      Write-Warning "Recovery proxy is running but not paired to a hosted relay. Copy services/recovery-local/.env.example to .env and configure the relay URL/owner token."
    }
  } else {
    Show-LogTail $recoveryErr "Recovery proxy errors"
    Write-Warning "Recovery proxy did not become ready. Existing Jazz functions are unaffected."
  }
} catch {
  Write-Warning "Recovery proxy startup failed; existing Jazz functions are unaffected: $($_.Exception.Message)"
}

# 6) Piper. Require the complete runtime path and a real synthesis test. If either
# check fails, repair once and retry automatically.
try {
  $piperSetup = Join-Path $root "tools\piper\setup-windows.ps1"
  $runtimeExe = Join-Path $root "tools\piper\runtime\piper.exe"
  $needsRepair = -not (Test-Path $runtimeExe)

  $ttsHealth = Invoke-RestMethod "http://127.0.0.1:$apiPort/api/tts-health" -TimeoutSec 8
  if (-not $ttsHealth.tts.ok -or $ttsHealth.tts.executable -notmatch '\\runtime\\piper\.exe$') {
    $needsRepair = $true
  }

  if (-not $needsRepair -and -not (Test-JazzPiperApi -Port $apiPort)) {
    $needsRepair = $true
  }

  if ($needsRepair) {
    if (-not (Test-Path $piperSetup)) { throw "Piper setup script is missing: $piperSetup" }
    Write-Host "Repairing complete Piper runtime + Windows dependencies..." -ForegroundColor Yellow
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $piperSetup
    if ($LASTEXITCODE -ne 0) { throw "Piper installer exited with code $LASTEXITCODE." }
    Start-Sleep -Milliseconds 350
  }

  $ttsHealth = Invoke-RestMethod "http://127.0.0.1:$apiPort/api/tts-health" -TimeoutSec 8
  if (-not $ttsHealth.tts.ok) {
    throw "Piper files are incomplete: $($ttsHealth.tts | ConvertTo-Json -Compress)"
  }
  if ($ttsHealth.tts.executable -notmatch '\\runtime\\piper\.exe$') {
    throw "Jazz selected the wrong Piper executable: $($ttsHealth.tts.executable)"
  }
  if (-not (Test-JazzPiperApi -Port $apiPort)) {
    throw "Piper files exist, but real speech synthesis still failed."
  }
  Write-Host "Piper TTS READY: $($ttsHealth.tts.executable)" -ForegroundColor Green
} catch {
  Write-Warning "Piper TTS is not ready; browser TTS fallback remains available: $($_.Exception.Message)"
}

# 7) Web UI. Clear both old and new Vite caches; vite.config.ts deduplicates
# react/react-dom so lucide-react and the app share the same hook dispatcher.
try {
  $webCommand = "Set-Location '$root\apps\web'; `$env:JAZZ_API_PORT='$apiPort'; `$env:JAZZ_STT_PORT='$sttPort'; Remove-Item -Recurse -Force '.\node_modules\.vite' -ErrorAction SilentlyContinue; Remove-Item -Recurse -Force '.\node_modules\.vite-jazz' -ErrorAction SilentlyContinue; pnpm exec vite --force --port $webPort --strictPort"
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
Write-Host "Web: http://localhost:$webPort/?v=20260924-understanding2" -ForegroundColor Green
Write-Host "API: http://127.0.0.1:$apiPort/health" -ForegroundColor Green
Write-Host "STT: http://127.0.0.1:$sttPort/health" -ForegroundColor Green
Write-Host "Recovery: http://127.0.0.1:$recoveryPort/health" -ForegroundColor Green
Write-Host "API logs: $apiOut ; $apiErr" -ForegroundColor DarkGray
Write-Host "STT logs: $sttOut ; $sttErr" -ForegroundColor DarkGray
Write-Host "Recovery logs: $recoveryOut ; $recoveryErr" -ForegroundColor DarkGray
