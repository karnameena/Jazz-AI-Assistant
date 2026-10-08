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
Write-Host "Running a short 2048-context generation request..." -ForegroundColor Cyan
$payload = @{
  model = $Model
  stream = $false
  think = $false
  keep_alive = "1m"
  messages = @(@{ role = "user"; content = "In one short paragraph, explain React.js and its components." })
  options = @{ num_ctx = 2048; num_predict = 128 }
} | ConvertTo-Json -Depth 12 -Compress

try {
  $result = Invoke-RestMethod -Method Post -Uri ($api + "/api/chat") -ContentType "application/json" -Body $payload -TimeoutSec 240
  $answer = [string]$result.message.content
  if (!$answer.Trim()) { throw "Ollama returned an empty message." }
  Write-Host ("PASS: Ollama generated " + $answer.Length + " characters with " + $Model) -ForegroundColor Green
  Write-Host $answer
} catch {
  Write-Host ("FAIL: Ollama model generation failed: " + $_.Exception.Message) -ForegroundColor Red
  Write-Host "The PDF generator cannot use this model until it can answer a short /api/chat request." -ForegroundColor Yellow
  Write-Host "Check available memory in Task Manager and look for Ollama runner exits in its Windows logs." -ForegroundColor Yellow
  exit 1
}
Write-Host "This checks direct Ollama inference, not final PDF rendering or remote JazzWhatsApp." -ForegroundColor DarkYellow
