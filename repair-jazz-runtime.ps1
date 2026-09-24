$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "Repairing Jazz runtime from origin/main..." -ForegroundColor Cyan

# Keep private/local config and user-owned Android automation scripts untouched.
# Only core source + generated dependency folders are refreshed.
$runtimeFiles = @(
  "package.json",
  "pnpm-workspace.yaml",
  "services/api/src/server.mjs",
  "services/api/src/ollama.mjs",
  "services/api/src/tts.mjs",
  "services/api/src/device-bridge.mjs",
  "services/api/src/android-intents.mjs",
  "services/api/src/script-registry.mjs",
  "services/api/src/utterance-normalizer.mjs",
  "services/api/tests/utterance-normalizer.test.mjs",
  "services/api/telegram.env.example",
  "services/stt/server.mjs",
  "services/recovery-local/server.mjs",
  "services/recovery-local/package.json",
  "services/recovery-local/.env.example",
  "services/recovery-relay/server.mjs",
  "services/recovery-relay/package.json",
  "services/recovery-relay/.env.example",
  "bridges/windows-adb/adb-bridge.mjs",
  "tools/piper/setup-windows.ps1",
  "tools/whisper/setup-windows.ps1",
  "apps/web/package.json",
  "apps/web/vite.config.ts",
  "apps/web/telegram-bridge.ts",
  "apps/web/scripts/telegram-login.mjs",
  "apps/web/index.html",
  "apps/web/public/api-runtime.js",
  "apps/web/public/favicon.svg",
  "apps/web/public/rich-code.js",
  "apps/web/public/rich-code.css",
  "apps/web/public/telegram-ui.js",
  "apps/web/public/telegram-ui.css",
  "apps/web/public/recovery-ui.js",
  "apps/web/public/recovery-ui.css",
  "apps/web/src/api-runtime.ts",
  "apps/web/src/main.tsx",
  "apps/web/src/TelegramPanel.tsx",
  "apps/web/src/telegram.css",
  "apps/web/src/voice.ts",
  "apps/web/src/voice-orb.css",
  "apps/web/src/voice-orb-stage.ts",
  "docs/telegram-bot.md",
  "start-jazz.ps1"
)

git fetch origin main
if ($LASTEXITCODE -ne 0) { throw "git fetch origin main failed." }

git checkout origin/main -- $runtimeFiles
if ($LASTEXITCODE -ne 0) { throw "Could not refresh Jazz runtime files from origin/main." }

$server = Get-Content ".\services\api\src\server.mjs" -Raw
if ($server -notmatch 'const VERSION = "0\.10\.0-local"') {
  throw "Repair failed: expected Jazz API 0.10.0-local was not found."
}
if ($server -match 'I tried the configured model and resilient fallbacks') {
  throw "Repair failed: legacy Gemini fallback text still exists."
}

$apiRuntime = Get-Content ".\apps\web\public\api-runtime.js" -Raw
if ($apiRuntime -notmatch 'window\.location\.origin') {
  throw "Repair failed: web API runtime is not LAN-safe/same-origin."
}
if ($apiRuntime -notmatch 'device-recovery' -or $apiRuntime -notmatch '127\.0\.0\.1:8799') {
  throw "Repair failed: Device Recovery chat interception is missing."
}

$indexHtml = Get-Content ".\apps\web\index.html" -Raw
if ($indexHtml -notmatch 'rich-code\.js' -or $indexHtml -notmatch 'rich-code\.css') {
  throw "Repair failed: Jazz rich code renderer is not loaded by index.html."
}
if (-not (Test-Path ".\apps\web\public\rich-code.js") -or -not (Test-Path ".\apps\web\public\rich-code.css")) {
  throw "Repair failed: Jazz rich code renderer assets are missing."
}
if ($indexHtml -notmatch 'telegram-ui\.js' -or $indexHtml -notmatch 'telegram-ui\.css') {
  throw "Repair failed: Jazz Telegram quick-action assets are not loaded by index.html."
}
if (-not (Test-Path ".\apps\web\public\telegram-ui.js") -or -not (Test-Path ".\apps\web\public\telegram-ui.css")) {
  throw "Repair failed: Jazz Telegram quick-action assets are missing."
}
if ($indexHtml -notmatch 'recovery-ui\.js' -or $indexHtml -notmatch 'recovery-ui\.css') {
  throw "Repair failed: Jazz Device Recovery UI assets are not loaded by index.html."
}
if (-not (Test-Path ".\apps\web\public\recovery-ui.js") -or -not (Test-Path ".\apps\web\public\recovery-ui.css")) {
  throw "Repair failed: Jazz Device Recovery UI assets are missing."
}

$mainTsx = Get-Content ".\apps\web\src\main.tsx" -Raw
if ($mainTsx -notmatch 'label:\s*"Telegram"' -or $mainTsx -match 'label:\s*"Translate"') {
  throw "Repair failed: Quick Actions is not using Telegram instead of Translate."
}

$vite = Get-Content ".\apps\web\vite.config.ts" -Raw
if ($vite -notmatch 'dedupe: \["react", "react-dom"\]') {
  throw "Repair failed: React dedupe configuration is missing."
}
if ($vite -notmatch 'require\.resolve\("react/package\.json"') {
  throw "Repair failed: hard React runtime pinning is missing."
}
if ($vite -notmatch 'host: "0\.0\.0\.0"') {
  throw "Repair failed: Jazz web is not exposed to the local network."
}
if ($vite -notmatch 'telegramBridgePlugin' -or $vite -notmatch 'telegram-bridge') {
  throw "Repair failed: isolated Telegram plugin is not wired into Vite."
}
if ($vite -notmatch 'JAZZ_STT_PORT' -or $vite -notmatch '"/stt-local"') {
  throw "Repair failed: local Whisper STT proxy is not wired into Vite."
}
if (-not (Test-Path ".\apps\web\telegram-bridge.ts")) {
  throw "Repair failed: isolated Telegram popup bridge file is missing."
}

$voiceTs = Get-Content ".\apps\web\src\voice.ts" -Raw
if ($voiceTs -notmatch '/stt-local/health' -or $voiceTs -notmatch '/stt-local/transcribe' -or $voiceTs -notmatch 'startLocalRecognition') {
  throw "Repair failed: Jazz web is not configured to use local Whisper speech-to-text."
}
if ($voiceTs -notmatch '/stt-local/normalize' -or $voiceTs -notmatch 'normalizeRecognizedText') {
  throw "Repair failed: browser speech results are not using the Jazz understanding layer."
}
if (-not (Test-Path ".\services\stt\server.mjs")) {
  throw "Repair failed: Jazz local STT service is missing."
}
if (-not (Test-Path ".\tools\whisper\setup-windows.ps1")) {
  throw "Repair failed: Jazz Whisper setup script is missing."
}
if (-not (Test-Path ".\services\api\src\utterance-normalizer.mjs")) {
  throw "Repair failed: Jazz utterance normalizer is missing."
}
$understanding = Get-Content ".\services\api\src\utterance-normalizer.mjs" -Raw
if ($understanding -notmatch 'normalizeUtterance' -or $understanding -notmatch 'requiresClarification' -or $understanding -notmatch 'debugUnderstanding') {
  throw "Repair failed: Jazz confidence-based understanding layer is incomplete."
}
$sttServerText = Get-Content ".\services\stt\server.mjs" -Raw
if ($sttServerText -notmatch 'rawText' -or $sttServerText -notmatch '"/normalize"' -or $sttServerText -notmatch '--prompt') {
  throw "Repair failed: Jazz STT raw transcript/normalization/prompt integration is incomplete."
}

$startJazz = Get-Content ".\start-jazz.ps1" -Raw
if ($startJazz -notmatch 'Local Whisper STT READY' -or $startJazz -notmatch 'services\\stt\\server\.mjs' -or $startJazz -notmatch 'JAZZ_STT_PORT') {
  throw "Repair failed: start-jazz.ps1 does not start the local Whisper service."
}
if ($startJazz -notmatch 'Recovery proxy READY' -or $startJazz -notmatch 'services\\recovery-local\\server\.mjs') {
  throw "Repair failed: start-jazz.ps1 does not start the isolated recovery proxy."
}
if (-not (Test-Path ".\services\recovery-local\server.mjs") -or -not (Test-Path ".\services\recovery-relay\server.mjs")) {
  throw "Repair failed: Jazz Device Recovery services are missing."
}

$telegramBridge = Get-Content ".\apps\web\telegram-bridge.ts" -Raw
if ($telegramBridge -notmatch 'jazz-telegram-popup-bridge' -or $telegramBridge -notmatch '/telegram-api/status') {
  throw "Repair failed: Telegram popup endpoints are missing."
}
if ($telegramBridge -notmatch '/telegram-api/events' -or $telegramBridge -notmatch '/telegram-api/media/') {
  throw "Repair failed: Telegram realtime/media endpoints are missing."
}
if ($telegramBridge -notmatch 'pathname\.startsWith\("/telegram-api/"\)') {
  throw "Repair failed: Telegram/Jazz router isolation guard is missing."
}
if ($telegramBridge -match 'replyMarkup\.map \?') {
  throw "Repair failed: stale Telegram keyboard parser detected."
}
if (-not (Test-Path ".\apps\web\src\TelegramPanel.tsx") -or -not (Test-Path ".\apps\web\src\telegram.css")) {
  throw "Repair failed: Jazz Telegram UI files are missing."
}
if (-not (Test-Path ".\apps\web\scripts\telegram-login.mjs")) {
  throw "Repair failed: Telegram user-session login helper is missing."
}
$telegramPanel = Get-Content ".\apps\web\src\TelegramPanel.tsx" -Raw
if ($telegramPanel -notmatch 'new EventSource\("/telegram-api/events"\)' -or $telegramPanel -notmatch 'telegram-start-button') {
  throw "Repair failed: Telegram START/realtime UI is incomplete."
}

# pnpm 11/12 requires explicit approval before running dependency build scripts.
# Vite depends on esbuild's install step, so approve only that known dependency.
$workspaceManifest = Get-Content ".\pnpm-workspace.yaml" -Raw
if ($workspaceManifest -notmatch '(?m)^allowBuilds:\s*$' -or $workspaceManifest -notmatch '(?m)^\s+esbuild:\s*true\s*$') {
  throw "Repair failed: pnpm allowBuilds approval for esbuild is missing."
}

# Stop old Jazz/Vite/STT/recovery Node processes BEFORE touching node_modules. Otherwise Windows
# can keep stale optimized React chunks or a stale local service open.
Write-Host "Stopping stale Jazz web/API/STT/recovery processes..." -ForegroundColor Yellow
$needle = [regex]::Escape($root)
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -match '^node(\.exe)?$' -and
    $_.CommandLine -match $needle -and
    ($_.CommandLine -match 'vite' -or $_.CommandLine -match 'server\.mjs' -or $_.CommandLine -match 'adb-bridge\.mjs')
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Milliseconds 600

# Rebuild the WHOLE pnpm workspace store/link tree. Deleting only apps/web/node_modules
# is not enough because a stale root node_modules can supply a second React copy.
Write-Host "Removing generated Node dependency trees..." -ForegroundColor Cyan
$rootNodeModules = Join-Path $root "node_modules"
$webNodeModules = Join-Path $root "apps\web\node_modules"
if (Test-Path $webNodeModules) { Remove-Item $webNodeModules -Recurse -Force }
if (Test-Path $rootNodeModules) { Remove-Item $rootNodeModules -Recurse -Force }

$pnpm = Get-Command pnpm -ErrorAction Stop
Write-Host "Installing one clean pnpm workspace dependency graph..." -ForegroundColor Cyan
& $pnpm.Source install --force
if ($LASTEXITCODE -ne 0) {
  throw "pnpm install failed while rebuilding Jazz dependencies. Check the pnpm output above; esbuild is explicitly approved in pnpm-workspace.yaml."
}

# Verify React and ReactDOM are exactly the versions Jazz web expects.
$versionCheck = @'
const react = require('./apps/web/node_modules/react/package.json');
const reactDom = require('./apps/web/node_modules/react-dom/package.json');
console.log(`React ${react.version} / ReactDOM ${reactDom.version}`);
if (react.version !== '18.3.1' || reactDom.version !== '18.3.1') process.exit(2);
'@
$versionCheck | node
if ($LASTEXITCODE -ne 0) { throw "React runtime verification failed. Expected React/ReactDOM 18.3.1." }

Write-Host "Validating Jazz understanding regression tests..." -ForegroundColor Cyan
& node ".\services\api\tests\utterance-normalizer.test.mjs"
if ($LASTEXITCODE -ne 0) {
  throw "Jazz speech/typing understanding regression tests failed."
}

# Compile the complete web app before starting Vite. This catches malformed TSX/JSX,
# missing imports, and Vite transform failures during repair instead of leaving the
# browser stuck on a red overlay after startup.
Write-Host "Validating Jazz web production build..." -ForegroundColor Cyan
& $pnpm.Source --filter "@jazz/web" build
if ($LASTEXITCODE -ne 0) {
  throw "Jazz web build validation failed. Fix the TSX/Vite error shown above before starting Jazz."
}
Remove-Item (Join-Path $root "apps\web\dist") -Recurse -Force -ErrorAction SilentlyContinue

# Remove every known Vite optimizer cache after dependency installation/build validation.
Remove-Item (Join-Path $root "apps\web\node_modules\.vite") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root "apps\web\node_modules\.vite-jazz") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root "node_modules\.vite") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $root "node_modules\.vite-jazz") -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Runtime source repaired successfully." -ForegroundColor Green
Write-Host "React runtime verified: one pinned React 18.3.1 + ReactDOM 18.3.1 installation." -ForegroundColor Green
Write-Host "Jazz understanding verified: typo/STT normalization + confidence/safety tests passed." -ForegroundColor Green
Write-Host "Jazz web production build verified: TSX/JSX + Vite transform passed." -ForegroundColor Green
Write-Host "Jazz local voice verified: Whisper service + Vite proxy + browser microphone pipeline are wired." -ForegroundColor Green
Write-Host "Jazz rich-code renderer verified." -ForegroundColor Green
Write-Host "Jazz Telegram quick action verified: Translate removed; Telegram loaded." -ForegroundColor Green
Write-Host "Jazz Telegram popup isolation verified: /telegram-api/* is separate from /api/chat." -ForegroundColor Green
Write-Host "Jazz Telegram rich media verified: photos, videos, files, maps and link previews are wired." -ForegroundColor Green
Write-Host "Jazz Telegram realtime verified: SSE event stream is wired." -ForegroundColor Green
Write-Host "Jazz Telegram callback/reply keyboard bridge verified by build." -ForegroundColor Green
Write-Host "Jazz Device Recovery verified: isolated local proxy + hosted relay + chat interception + recovery UI are wired." -ForegroundColor Green
Write-Host "Jazz web LAN access verified: Vite listens on 0.0.0.0 and /api stays same-origin." -ForegroundColor Green
Write-Host "pnpm build approval verified: esbuild only." -ForegroundColor Green
Write-Host "Private .env files were not changed." -ForegroundColor DarkGray
Write-Host "Local Android automation scripts were preserved and not checked out from Git." -ForegroundColor Green
Write-Host "Starting Jazz..." -ForegroundColor Cyan

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\start-jazz.ps1"
