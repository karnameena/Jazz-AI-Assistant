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

# Pinned Piper Windows runtime. The executable MUST stay beside its DLL files.
# Copying only piper.exe causes Windows STATUS_DLL_NOT_FOUND (0xC0000135 / 3221225781).
$piperUrl = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip"
Write-Host "Downloading Piper Windows runtime..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $piperUrl -OutFile $piperZip
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

# Remove the old broken flattened executable if a previous Jazz setup created it.
$legacyExe = Join-Path $root "piper.exe"
if (Test-Path $legacyExe) { Remove-Item $legacyExe -Force -ErrorAction SilentlyContinue }

# Female English Amy model.
$modelUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx?download=true"
$configUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json?download=true"
$model = Join-Path $voices "en_US-amy-medium.onnx"
$config = Join-Path $voices "en_US-amy-medium.onnx.json"

if (-not (Test-Path $model)) {
  Write-Host "Downloading Amy female English voice..." -ForegroundColor Cyan
  Invoke-WebRequest -Uri $modelUrl -OutFile $model
}
if (-not (Test-Path $config)) {
  Invoke-WebRequest -Uri $configUrl -OutFile $config
}

# Real synthesis smoke test. This catches missing DLL/runtime dependencies immediately.
$testWave = Join-Path $env:TEMP "jazz-piper-smoke-test.wav"
Remove-Item $testWave -Force -ErrorAction SilentlyContinue
$oldPath = $env:PATH
try {
  $env:PATH = "$runtime;$oldPath"
  "Jazz ready." | & $runtimeExe --model $model --espeak_data $espeakData --output_file $testWave 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $testWave)) {
    throw "Piper smoke test failed with exit code $LASTEXITCODE."
  }
} finally {
  $env:PATH = $oldPath
  Remove-Item $testWave -Force -ErrorAction SilentlyContinue
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Piper TTS is ready for Jazz." -ForegroundColor Green
Write-Host "Runtime: $runtimeExe"
Write-Host "Voice:   $model"
Write-Host "eSpeak:  $espeakData"
