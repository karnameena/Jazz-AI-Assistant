# Verifies the live Jazz API and the actual chat routes using a temporary Excel
# workbook. Does not run a model, modify source files, or perform device actions.
# For a hosted Jazz frontend, supply its actual API via -ApiBaseUrl.
# Optionally inspect the same-origin Vite proxy using -WebBaseUrl.
param(
  [string]$ApiBaseUrl = "http://127.0.0.1:8797",
  [string]$WebBaseUrl = "http://localhost:5173"
)
$ErrorActionPreference = "Stop"
$expectedBuild = "20261008-document-route-guard-v4"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Checking Jazz at $ApiBaseUrl" -ForegroundColor Cyan

$branch = (& git -C $root branch --show-current 2>$null)
$revision = (& git -C $root rev-parse --short HEAD 2>$null)
if ($LASTEXITCODE -eq 0) {
  Write-Host "Local Git branch: $branch; revision: $revision"
  if ($branch -ne "feature/jazz-intelligence-attachments-20261008") {
    Write-Warning "This is NOT the reviewed document-upgrade branch. Do not overwrite local changes; switch to the reviewed branch or use Jazz-AI-Test."
  }
}

$url = $ApiBaseUrl.TrimEnd("/") + "/api/routing/health"
try {
  $response = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 12
} catch {
  Write-Host "FAIL: The selected Jazz API does not expose the upgraded routing endpoint: $url" -ForegroundColor Red
  Write-Host "This usually means Jazz is connected to an older/different server, the API is offline, or a reverse proxy is misconfigured." -ForegroundColor Yellow
  if ($ApiBaseUrl -match "^(?:http://)?(?:127\.0\.0\.1|localhost)") {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8797 -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
      if ($process) {
        Write-Host ("Local port 8797 PID: " + $listener.OwningProcess + " (" + $process.Name + ")")
        Write-Host ("Command: " + $process.CommandLine)
      }
    }
  }
  exit 1
}

Write-Host ("Connected API version: " + $response.version)
Write-Host ("Routing build: " + $response.routingBuild)
$example = $response.samples.PSObject.Properties["Create a professional PDF report about React.js"].Value
if ($response.routingBuild -ne $expectedBuild -or -not $response.documentGeneration -or $example.type -ne "artifact" -or $example.kind -ne "pdf") {
  Write-Host "FAIL: This endpoint is not serving the correct document-routing upgrade." -ForegroundColor Red
  Write-Host "Make sure Jazz settings use this updated API and restart the correct Node process." -ForegroundColor Yellow
  exit 1
}

Write-Host "PASS: PDF requests are routed to the artifact generator on this API." -ForegroundColor Green
Write-Host "Checking the actual /api/chat handler with a temporary Excel workbook..." -ForegroundColor Cyan
# Validate the legacy web mode-prefix that previously routed document commands
# into the isolated coding agent even though the normal routing test passed.
$testText = "[JAZZ_MODE:NORMAL] Create an Excel React expense tracker"
$payload = @{ message = $testText; source = "typed"; history = @() } | ConvertTo-Json -Depth 5 -Compress
try {
  $chat = Invoke-RestMethod -Method Post -Uri ($ApiBaseUrl.TrimEnd("/") + "/api/chat") -ContentType "application/json" -Body $payload -TimeoutSec 30
  if ($chat.mode -ne "artifact-generation" -or $chat.artifact.kind -ne "xlsx" -or $chat.artifact.url -notmatch '^/api/artifacts/') {
    Write-Host ("FAIL: The live /api/chat route returned mode=" + $chat.mode + ".") -ForegroundColor Red
    Write-Host "This is not the expected document-generation path." -ForegroundColor Yellow
    exit 1
  }
  Write-Host "PASS: Real /api/chat Normal-mode-tagged request generated a downloadable Excel artifact." -ForegroundColor Green
} catch {
  Write-Host ("FAIL: Real /api/chat smoke test failed: " + $_.Exception.Message) -ForegroundColor Red
  exit 1
}

try {
  $evilPayload = @{ message = "[JAZZ_MODE:EVIL] Create an Excel React expense tracker"; source = "typed"; history = @() } | ConvertTo-Json -Depth 5 -Compress
  $stream = Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($ApiBaseUrl.TrimEnd("/") + "/api/chat/stream") -ContentType "application/json" -Headers @{ Accept = "text/event-stream" } -Body $evilPayload -TimeoutSec 30
  $streamText = [string]$stream.Content
  if ($streamText -notmatch 'artifact-generation' -or $streamText -notmatch '/api/artifacts/') {
    Write-Host "FAIL: /api/chat/stream did not return a downloadable file." -ForegroundColor Red
    exit 1
  }
  Write-Host "PASS: Real /api/chat/stream Evil-mode-tagged request also generated a file." -ForegroundColor Green
} catch {
  Write-Host ("FAIL: Streaming chat smoke test failed: " + $_.Exception.Message) -ForegroundColor Red
  exit 1
}

if ($WebBaseUrl) {
  $site = $WebBaseUrl.TrimEnd("/")
  Write-Host ("Checking the frontend-origin API proxy: " + $site) -ForegroundColor Cyan
  try {
    $siteVersion = Invoke-RestMethod -Method Get -Uri ($site + "/api/routing/health") -TimeoutSec 8
    if ($siteVersion.routingBuild -ne $expectedBuild) {
      Write-Warning "This web origin is connected to another Jazz backend. Its routing build differs from the local API."
    } else {
      Write-Host "PASS: Frontend-origin API points to the updated routing build." -ForegroundColor Green
    }
  } catch {
    Write-Warning ("Cannot verify the frontend-origin API: " + $_.Exception.Message + ". Your browser may be using a different frontend host or remote Jazz server.")
  }
}
Write-Host "Checks passed for this selected API. PDF model inference, WhatsApp remote endpoints, and Android hardware still require separate tests." -ForegroundColor DarkYellow
