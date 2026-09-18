$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtime = Join-Path $root "runtime"
$voices = Join-Path $root "voices"
$stage = Join-Path $env:TEMP "jazz-piper-stage"
$piperZip = Join-Path $env:TEMP "jazz-piper-windows.zip"

New-Item -ItemType Directory -Force -Path $voices | Out-Null
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $runtime -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage,$runtime | Out-Null

function Test-PiperSmoke {
  param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string]$Model,
    [Parameter(Mandatory = $true)][string]$EspeakData,
    [Parameter(Mandatory = $true)][string]$RuntimeDir
  )

  $testWave = Join-Path $env:TEMP "jazz-piper-smoke-test.wav"
  Remove-Item $testWave -Force -ErrorAction SilentlyContinue
  $oldPath = $env:PATH
  try {
    $env:PATH = "$RuntimeDir;$oldPath"
    "Jazz ready." | & $Exe --model $Model --espeak_data $EspeakData --output_file $testWave 2>&1 | Out-Null
    $code = $LASTEXITCODE
    return [pscustomobject]@{
      Ok = ($code -eq 0 -and (Test-Path $testWave))
      ExitCode = $code
      WaveCreated = (Test-Path $testWave)
    }
  } finally {
    $env:PATH = $oldPath
    Remove-Item $testWave -Force -ErrorAction SilentlyContinue
  }
}

function Install-VcRuntimeX64 {
  $vcUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
  $vcInstaller = Join-Path $env:TEMP "jazz-vc_redist.x64.exe"
  Write-Host "Installing Microsoft Visual C++ 2015-2022 x64 runtime required by Piper..." -ForegroundColor Yellow
  Invoke-WebRequest -UseBasicParsing -Uri $vcUrl -OutFile $vcInstaller
  try {
    $process = Start-Process -FilePath $vcInstaller -ArgumentList @("/install", "/quiet", "/norestart") -Wait -PassThru
    if ($process.ExitCode -notin @(0, 1638, 3010)) {
      throw "Visual C++ Redistributable installer exited with code $($process.ExitCode)."
    }
    if ($process.ExitCode -eq 3010) {
      Write-Warning "Visual C++ runtime installed and Windows requested a restart. Piper will be retried now; restart Windows later if it still cannot load."
    }
  } finally {
    Remove-Item $vcInstaller -Force -ErrorAction SilentlyContinue
  }
}

# Pinned Piper Windows runtime. The executable MUST stay beside its DLL files.
# Copying only piper.exe causes Windows STATUS_DLL_NOT_FOUND (0xC0000135 / 3221225781).
$piperUrl = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip"
Write-Host "Downloading Piper Windows runtime..." -ForegroundColor Cyan
Invoke-WebRequest -UseBasicParsing -Uri $piperUrl -OutFile $piperZip
Expand-Archive -Path $piperZip -DestinationPath $stage -Force
Remove-Item $piperZip -Force -ErrorAction SilentlyContinue

$exe = Get-ChildItem -Path $stage -Filter "piper.exe" -Recurse | Select-Object -First 1
if (-not $exe) { throw "piper.exe was not found in the downloaded Piper archive." }

$sourceDir = $exe.Directory.FullName
Write-Host "Installing complete Piper runtime from $sourceDir..."
Copy-Item (Join-Path $sourceDir "*") $runtime -Recurse -Force

$runtimeExe = Join-Path $runtime "piper.exe"
if (-not (Test-Path $runtimeExe)) { throw "Piper runtime installation failed: $runtimeExe was not created." }

$dlls = @(Get-ChildItem -Path $runtime -Filter "*.dll" -File -ErrorAction SilentlyContinue)
if ($dlls.Count -eq 0) {
  throw "Piper runtime installation is incomplete: no runtime DLL files were copied beside piper.exe."
}

$espeakData = Join-Path $runtime "espeak-ng-data"
if (-not (Test-Path $espeakData)) {
  $foundEspeak = Get-ChildItem -Path $stage -Directory -Filter "espeak-ng-data" -Recurse | Select-Object -First 1
  if ($foundEspeak) {
    Copy-Item $foundEspeak.FullName $espeakData -Recurse -Force
  }
}
if (-not (Test-Path $espeakData)) { throw "Piper eSpeak data folder was not found in the Windows runtime." }

# Remove old broken layouts so Jazz can never select a detached piper.exe again.
$legacyExe = Join-Path $root "piper.exe"
if (Test-Path $legacyExe) { Remove-Item $legacyExe -Force -ErrorAction SilentlyContinue }

# Female English Amy model.
$modelUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx?download=true"
$configUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json?download=true"
$model = Join-Path $voices "en_US-amy-medium.onnx"
$config = Join-Path $voices "en_US-amy-medium.onnx.json"

if (-not (Test-Path $model)) {
  Write-Host "Downloading Amy female English voice..." -ForegroundColor Cyan
  Invoke-WebRequest -UseBasicParsing -Uri $modelUrl -OutFile $model
}
if (-not (Test-Path $config)) {
  Invoke-WebRequest -UseBasicParsing -Uri $configUrl -OutFile $config
}

# Real synthesis smoke test. 0xC0000135 means a Windows runtime DLL is missing.
$smoke = Test-PiperSmoke -Exe $runtimeExe -Model $model -EspeakData $espeakData -RuntimeDir $runtime
if (-not $smoke.Ok) {
  if ($smoke.ExitCode -eq -1073741515 -or $smoke.ExitCode -eq 3221225781) {
    Install-VcRuntimeX64
    $smoke = Test-PiperSmoke -Exe $runtimeExe -Model $model -EspeakData $espeakData -RuntimeDir $runtime
  }
}

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue

if (-not $smoke.Ok) {
  throw "Piper smoke test failed with exit code $($smoke.ExitCode). Runtime: $runtimeExe"
}

Write-Host ""
Write-Host "Piper TTS is ready for Jazz." -ForegroundColor Green
Write-Host "Runtime: $runtimeExe"
Write-Host "Runtime DLLs: $($dlls.Count)"
Write-Host "Voice:   $model"
Write-Host "eSpeak:  $espeakData"
