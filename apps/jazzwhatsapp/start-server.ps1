param([int]$Port = 8797, [switch]$SetupAccount)
$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Set-Location $repoRoot
$env:PORT = [string]$Port
$env:JAZZ_REMINDER_DELIVERY = 'jazzwhatsapp'
$env:JAZZWHATSAPP_ALLOW_SIGNUP = if ($SetupAccount) { 'true' } else { 'false' }
Write-Host "Starting the existing Jazz API on port $Port with JazzWhatsApp reminder delivery."
if ($SetupAccount) { Write-Host 'First-account setup is enabled. After creating your account, restart without -SetupAccount.' }
node (Join-Path $repoRoot 'services\api\src\server.mjs')
