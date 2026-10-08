# Read-only verification of the live Jazz API, not a model installer or a launcher.
# Run from the reviewed Jazz branch. Use -ApiBaseUrl when Jazz points to Render/Cloudflare.
param(
  [string]$ApiBaseUrl = "http://127.0.0.1:8797"
)
$ErrorActionPreference = "Stop"
$expectedBuild = "20261008-document-route-guard-v3"
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
Write-Host "This checks routing, not Ollama model speed, actual PDF generation, or Android hardware." -ForegroundColor DarkYellow
