# Read-only Ollama connection and small text-generation check for 8 GB Windows PCs.
# Does not delete models, stop processes, or change Normal/Evil mode settings.
param(
  [string]$OllamaUrl = "http://127.0.0.1:11434",
  [string]$Model = "qwen3:4b"
)
$ErrorActionPreference = "Stop"
$api = $OllamaUrl.TrimEnd("/")
Write-Host ("Checking Ollama API: " + $api) -ForegroundColor Cyan
try {
  $tags = Invoke-RestMethod -Method Get -Uri ($api + "/api/tags") -TimeoutSec 10
} catch {
  Write-Host ("FAIL: Ollama is not reachable: " + $_.Exception.Message) -ForegroundColor Red
  Write-Host "Start Ollama normally and check that port 11434 is reachable before attempting a PDF." -ForegroundColor Yellow
  exit 1
}
$names = @($tags.models | ForEach-Object { $_.name })
Write-Host ("Installed models: " + ($names -join ", "))
if ($names -notcontains $Model) {
  Write-Host ("FAIL: Model '" + $Model + "' was not found in /api/tags.") -ForegroundColor Red
  exit 1
}
Write-Host "Checking actual Node.js fetch with a short 2048-context request..." -ForegroundColor Cyan
$scriptFile = Join-Path $PSScriptRoot "services\\api\\scripts\\diagnose-ollama.mjs"
if (!(Test-Path $scriptFile)) { throw "Node Ollama diagnostic script is missing: $scriptFile" }
& node $scriptFile $Model $api
if ($LASTEXITCODE -ne 0) {
  Write-Host "The JavaScript Ollama connection failed. Check Task Manager memory and Ollama server logs." -ForegroundColor Red
  exit 1
}
Write-Host "This checks direct Ollama inference, not final PDF rendering or remote JazzWhatsApp." -ForegroundColor DarkYellow
