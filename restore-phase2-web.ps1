$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$phaseBranch = "phase2-stil-telegram-function"
$phaseRef = "origin/$phaseBranch"
$webPort = 5173

Write-Host "Restoring Jazz web from saved Phase 2 baseline..." -ForegroundColor Cyan
Write-Host "Baseline: $phaseBranch" -ForegroundColor DarkGray

# Fetch both the current main branch and the saved known-good web baseline.
git fetch origin main $phaseBranch
if ($LASTEXITCODE -ne 0) {
  throw "Could not fetch main and $phaseBranch from origin."
}

# Stop only repo-owned Vite/web processes before replacing the web tree.
$needle = [regex]::Escape($root)
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -match '^node(\.exe)?$' -and
    $_.CommandLine -match $needle -and
    $_.CommandLine -match 'vite'
  } |
  ForEach-Object {
    Write-Host "Stopping stale Jazz web process PID $($_.ProcessId)..." -ForegroundColor DarkYellow
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
try {
  Get-NetTCPConnection -LocalPort $webPort -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
} catch {}
Start-Sleep -Milliseconds 500

# The saved Phase 2 branch is the user's known-good web snapshot. Restore the
# COMPLETE apps/web tree, not only main.tsx, so Telegram, voice, quick actions,
# CSS, Vite plugin wiring, and helper scripts stay in sync.
git checkout $phaseRef -- apps/web
if ($LASTEXITCODE -ne 0) {
  throw "Could not restore apps/web from $phaseRef."
}

# Deep integrity checks for the functions the saved UI is expected to contain.
$mainTsx = Get-Content ".\apps\web\src\main.tsx" -Raw
$requiredMainPatterns = @(
  'import \{ TelegramPanel \} from "\.\/TelegramPanel"',
  'const \[telegramOpen, setTelegramOpen\] = useState\(false\)',
  'label:\s*"Telegram"',
  'setTelegramOpen\(true\)',
  '<TelegramPanel open=\{telegramOpen\}',
  'label:\s*"Take a Note"',
  'label:\s*"Set Reminder"',
  'label:\s*"Open Calculator"',
  'label:\s*"Search Web"',
  'label:\s*"Generate Image"',
  'label:\s*"Open YouTube"',
  'label:\s*"Send WhatsApp"',
  'label:\s*"Take a screenshot"',
  'label:\s*"Open Instagram"',
  'label:\s*"Play music"',
  'text="Agents"',
  'text="Memory"',
  'text="Knowledge Base"',
  'text="Tasks"',
  'text="Reminders"',
  'text="Calendar"',
  'text="Devices"',
  'text="Automations"',
  'text="Analytics"',
  'text="Settings"'
)
foreach ($pattern in $requiredMainPatterns) {
  if ($mainTsx -notmatch $pattern) {
    throw "Phase 2 restore verification failed. Missing main.tsx feature pattern: $pattern"
  }
}

$requiredFiles = @(
  ".\apps\web\src\TelegramPanel.tsx",
  ".\apps\web\src\telegram.css",
  ".\apps\web\telegram-bridge.ts",
  ".\apps\web\scripts\telegram-login.mjs",
  ".\apps\web\src\voice.ts",
  ".\apps\web\src\voice-orb.css",
  ".\apps\web\src\voice-orb-stage.ts",
  ".\apps\web\src\styles.css",
  ".\apps\web\src\chat-overrides.css",
  ".\apps\web\vite.config.ts",
  ".\apps\web\package.json"
)
foreach ($file in $requiredFiles) {
  if (-not (Test-Path $file)) { throw "Phase 2 restore verification failed. Missing: $file" }
}

$telegramPanel = Get-Content ".\apps\web\src\TelegramPanel.tsx" -Raw
if ($telegramPanel -notmatch 'telegram-start-button' -or
    $telegramPanel -notmatch 'new EventSource\("/telegram-api/events"\)' -or
    $telegramPanel -notmatch '/telegram-api') {
  throw "Telegram panel was restored but its START/realtime/API workflow is incomplete."
}

$telegramBridge = Get-Content ".\apps\web\telegram-bridge.ts" -Raw
if ($telegramBridge -notmatch 'telegramBridgePlugin' -or
    $telegramBridge -notmatch '/telegram-api/status' -or
    $telegramBridge -notmatch '/telegram-api/events') {
  throw "Telegram bridge was restored but required endpoints are missing."
}

$vite = Get-Content ".\apps\web\vite.config.ts" -Raw
if ($vite -notmatch 'telegramBridgePlugin' -or $vite -notmatch 'telegram-bridge') {
  throw "Vite is not wired to the restored Telegram bridge."
}

# Rebuild the web dependency links and force Vite to throw away stale optimized chunks.
$pnpm = Get-Command pnpm -ErrorAction Stop
Write-Host "Refreshing Jazz web dependencies..." -ForegroundColor Cyan
& $pnpm.Source install --filter "@jazz/web" --force
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed for Jazz web." }

Remove-Item ".\apps\web\node_modules\.vite" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item ".\apps\web\node_modules\.vite-jazz" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Validating the complete restored web build..." -ForegroundColor Cyan
& $pnpm.Source --filter "@jazz/web" build
if ($LASTEXITCODE -ne 0) {
  throw "The restored Phase 2 web source did not compile. Fix the build error above before starting Jazz."
}
Remove-Item ".\apps\web\dist" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "" 
Write-Host "Phase 2 web restore VERIFIED." -ForegroundColor Green
Write-Host "Telegram quick action + TelegramPanel restored." -ForegroundColor Green
Write-Host "Telegram START, realtime events, keyboard/media bridge restored." -ForegroundColor Green
Write-Host "Quick Actions, device commands, notes, reminders, search and image action restored." -ForegroundColor Green
Write-Host "Sidebar workspaces and voice UI restored." -ForegroundColor Green
Write-Host "No services/api .env or Android automation scripts were changed." -ForegroundColor DarkGray
Write-Host "" 
Write-Host "Restarting Jazz with the restored web..." -ForegroundColor Cyan

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\start-jazz.ps1"
