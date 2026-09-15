$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$voices = Join-Path $root "voices"
New-Item -ItemType Directory -Force -Path $voices | Out-Null

# Pinned Piper Windows runtime. Keeping this pinned makes local Jazz setup reproducible.
$piperZip = Join-Path $env:TEMP "jazz-piper-windows.zip"
$piperUrl = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip"
Write-Host "Downloading Piper runtime..."
Invoke-WebRequest -Uri $piperUrl -OutFile $piperZip
Expand-Archive -Path $piperZip -DestinationPath $root -Force
Remove-Item $piperZip -Force

# Flatten the common release layout if the executable is nested.
$exe = Get-ChildItem -Path $root -Filter "piper.exe" -Recurse | Select-Object -First 1
if (-not $exe) { throw "piper.exe was not found after extracting the runtime." }
if ($exe.FullName -ne (Join-Path $root "piper.exe")) {
  Copy-Item $exe.FullName (Join-Path $root "piper.exe") -Force
}

# Female English Amy model.
$modelUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx?download=true"
$configUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json?download=true"
$model = Join-Path $voices "en_US-amy-medium.onnx"
$config = Join-Path $voices "en_US-amy-medium.onnx.json"
Write-Host "Downloading Amy female English voice..."
Invoke-WebRequest -Uri $modelUrl -OutFile $model
Invoke-WebRequest -Uri $configUrl -OutFile $config

Write-Host ""
Write-Host "Piper is ready for Jazz." -ForegroundColor Cyan
Write-Host "Runtime: $root\piper.exe"
Write-Host "Voice:   $model"
