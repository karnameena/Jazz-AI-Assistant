param([string]$SdkPath = '', [string]$OutputDirectory = "$env:USERPROFILE\Downloads")
$ErrorActionPreference = 'Stop'
if (!$SdkPath) { $SdkPath = $env:ANDROID_HOME }
if (!$SdkPath) { $SdkPath = $env:ANDROID_SDK_ROOT }
if (!$SdkPath) { $SdkPath = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (!(Test-Path $SdkPath)) { throw 'Android SDK not found. Install Android Studio and Android SDK Platform 34 + Build Tools 34.0.0, then run this script with -SdkPath YOUR_SDK_FOLDER.' }
if (!$env:JAVA_HOME) {
    $studioJava = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
    if (Test-Path $studioJava) { $env:JAVA_HOME = $studioJava }
}
Set-Content -Path (Join-Path $PSScriptRoot 'local.properties') -Value ('sdk.dir=' + $SdkPath.Replace('\', '/')) -Encoding ascii
Push-Location $PSScriptRoot
try {
    & .\gradlew.bat --no-daemon assembleDebug lintDebug --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Android build or lint failed. Share the error output; no APK was delivered.' }
    New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
    $apk = Join-Path $OutputDirectory 'JazzAi-1.0.6.apk'
    Copy-Item '.\app\build\outputs\apk\debug\app-debug.apk' $apk -Force
    Write-Host "Built APK: $apk"
    Write-Host 'Install this APK on your phone/tablet, then allow microphone, notification and camera permissions as needed.'
    Write-Host 'If Android reports a signing conflict with an earlier APK, see the included setup instructions before removing the old app.'
} finally { Pop-Location }
