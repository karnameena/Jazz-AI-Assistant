param(
    [string]$BridgeUrl = "http://127.0.0.1:9899",
    [ValidateSet("android-phone", "android-tablet")]
    [string]$DeviceId = "android-phone"
)

$ErrorActionPreference = "Stop"

$endpoint = "$($BridgeUrl.TrimEnd('/'))/command"
$body = @{
    deviceId = $DeviceId
    action   = "wake_screen"
    args     = @{}
} | ConvertTo-Json -Depth 4

$result = Invoke-RestMethod `
    -Method POST `
    -Uri $endpoint `
    -ContentType "application/json" `
    -Body $body `
    -TimeoutSec 20

if ($result.ok -eq $false) {
    throw ($result.error ?? $result.message ?? "Jazz could not wake the Android device.")
}

[pscustomobject]@{
    ok             = $true
    status         = if ($result.status) { $result.status } else { "authentication_required" }
    message        = if ($result.message) { $result.message } else { "Mobile is awake. Authenticate on the device, then Jazz can continue." }
    deviceId       = $DeviceId
    script         = "unlockmobile.ps1"
    executedScript = $true
} | ConvertTo-Json -Compress
