# Jazz Device Recovery

Jazz Device Recovery is an **owner-only** recovery channel for the Android device where Jazz Android Companion was previously installed, paired, and authorized. It is intentionally separate from the existing local ADB, PowerShell-script, Accessibility, Ollama, Telegram, and voice pipelines.

## Architecture

```text
Jazz voice/chat + Device Recovery panel
            |
            | localhost only
            v
services/recovery-local :8799
            |
            | HTTPS + owner bearer token
            v
Hosted services/recovery-relay
            ^
            | HTTPS + device bearer token
            | timestamp + nonce + HMAC signature
            |
Jazz Android Companion on Wi-Fi or cellular data
            |
            +-- status / battery / network
            +-- fused location
            +-- recovery ring
            +-- owner-enabled Lost Device Mode
            +-- Android-compliant camera recovery when Android permits it
```

The phone makes the outbound internet connection. The phone does **not** expose an unauthenticated public HTTP server.

## Existing Jazz flows stay separate

Device Recovery does not replace or reroute the existing local-control flows:

- ADB bridge remains on port `9899`.
- `JazzAccessibilityService` continues to handle normal Android UI automation.
- Existing user-owned PowerShell/ADB scripts remain separate.
- Ollama continues to handle normal AI chat.
- Whisper/Piper voice functionality is unchanged.

Only recovery phrases are intercepted by the web runtime and sent to the dedicated local recovery proxy before they can reach Ollama.

## Android files

Recovery is split into focused components under:

```text
apps/android-companion/app/src/main/java/com/gunakarna/jazzassistant/recovery/
```

Key components:

- `RecoverySecurityManager.kt` — device identity, Android Keystore encrypted recovery token, HMAC request signatures.
- `LostDeviceManager.kt` — `NORMAL_MODE` / `LOST_DEVICE_MODE`.
- `DeviceStatusManager.kt` — battery, charging state, connectivity and network type.
- `DeviceLocationManager.kt` — Fused Location Provider with live vs last-known labeling.
- `RecoveryNetworkClient.kt` — outbound HTTPS heartbeat, command pull, command result upload.
- `RecoveryHeartbeatWorker.kt` — normal-mode periodic connectivity.
- `RecoveryForegroundService.kt` — visible 10-second polling while Lost Device Mode is enabled.
- `RecoveryRingManager.kt` — Android-supported recovery ringtone.
- `RecoveryCameraManager.kt` / `RecoveryCaptureActivity.kt` — visible CameraX recovery capture when Android permits camera access.
- `RecoveryCommandExecutor.kt` — strict recovery-command allowlist.
- `RecoveryBootReceiver.kt` — restores heartbeat scheduling after reboot/package update.

`JazzAccessibilityService` is not used to bypass location, camera, lock-screen, or privacy restrictions.

## Permissions added

The Android manifest adds:

- `INTERNET`
- `ACCESS_NETWORK_STATE`
- `ACCESS_FINE_LOCATION`
- `ACCESS_COARSE_LOCATION`
- `CAMERA`
- `POST_NOTIFICATIONS`
- `FOREGROUND_SERVICE`
- `FOREGROUND_SERVICE_DATA_SYNC`
- `FOREGROUND_SERVICE_LOCATION`
- `WAKE_LOCK`
- `RECEIVE_BOOT_COMPLETED`

Location, camera, and notification permissions are requested through normal Android runtime permission UI.

The app does **not** request or implement covert microphone recording for Lost Device Mode.

## Security model

### Device to relay

The Android Companion creates a random recovery pairing token and stores it encrypted with an AES-GCM key held in Android Keystore.

Each device request contains:

```text
Authorization: Bearer <device token>
X-Jazz-Device-Id: <registered device id>
X-Jazz-Timestamp: <epoch milliseconds>
X-Jazz-Nonce: <random nonce>
X-Jazz-Signature: <HMAC-SHA256>
```

The HMAC covers:

```text
timestamp
nonce
HTTP method
request path
SHA-256(request body)
```

The relay rejects missing/invalid authentication, stale timestamps, mismatched device IDs, invalid signatures, and replayed nonces.

### Owner to relay

The hosted relay uses a **different** owner token. The owner token is stored only in the local PC file:

```text
services/recovery-local/.env
```

The browser talks to the localhost recovery proxy; the owner token is not placed in the Jazz web bundle.

Never commit either token.

## Hosted relay deployment

Deploy only:

```text
services/recovery-relay
```

The service has no external npm dependencies.

For Render, create a Web Service using this repository and configure:

```text
Root directory: services/recovery-relay
Start command: node server.mjs
```

Configure these environment variables:

```text
JAZZ_RECOVERY_DEVICE_ID=<device ID copied from Android Companion>
JAZZ_RECOVERY_DEVICE_TOKEN=<pairing token copied from Android Companion>
JAZZ_RECOVERY_OWNER_TOKEN=<different long random token>
```

Render supplies `PORT` automatically. The relay must be exposed through HTTPS.

Generate an owner token on the PC with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

The relay currently keeps the latest status, location, command queue, and recovery photo in memory. A production deployment that must survive relay restarts should add a persistent store such as Redis/Postgres or a mounted persistent disk.

## Local PC setup

Create the private local config:

```powershell
Copy-Item .\services\recovery-local\.env.example .\services\recovery-local\.env
notepad .\services\recovery-local\.env
```

Set:

```text
JAZZ_RECOVERY_LOCAL_PORT=8799
JAZZ_RECOVERY_RELAY_URL=https://your-render-service.onrender.com
JAZZ_RECOVERY_OWNER_TOKEN=<same owner token configured on relay>
```

Then start Jazz normally:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-jazz.ps1
```

Expected startup line:

```text
Recovery proxy READY on port 8799, configured=True
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8799/health | ConvertTo-Json -Depth 5
```

## Android setup

1. Build/install the updated Android Companion.
2. Open Jazz Android Companion.
3. Tap **Request Recovery Permissions** and grant the permissions you want Recovery Mode to use.
4. Enter the HTTPS hosted relay URL and tap **Save Recovery Server URL**.
5. Tap **Copy Recovery Device ID** and put that value in the relay's `JAZZ_RECOVERY_DEVICE_ID` environment variable.
6. Tap **Copy Recovery Pairing Token** and put that value in the relay's `JAZZ_RECOVERY_DEVICE_TOKEN` environment variable.
7. Configure a different `JAZZ_RECOVERY_OWNER_TOKEN` on both the relay and the PC local recovery `.env`.
8. Restart/redeploy the relay after setting environment variables.
9. Enable **Lost Device Mode** when you want the faster recovery heartbeat.

The Android Companion can use Wi-Fi or cellular mobile data. A local ADB connection is not required for recovery commands once the hosted relay is configured.

## Quick Action

The web runtime replaces the visible **Open Calculator** Quick Action with:

```text
📱 DEVICE RECOVERY
```

The panel provides:

```text
Get Location
Ring Phone
Front Camera
Rear Camera
Refresh Status
Disable Lost Mode
```

Panel buttons send the corresponding command through the normal Jazz chat UI so the request and response remain visible in chat.

Location responses render as a Telegram-style location card with coordinates, accuracy, live/last-known status, capture time, and an **Open Location** link.

Recovery photos render directly inside the Jazz chat as an image card with device, camera and captured-time metadata.

## Voice/chat commands

Recovery commands are recognized before Ollama:

```text
Hey Jazz, where is my phone?
Hey Jazz, send me my mobile location.
Hey Jazz, locate my lost phone.
Hey Jazz, take a front-camera recovery photo.
Hey Jazz, take a rear-camera recovery photo.
Hey Jazz, send me the latest recovery photo.
Hey Jazz, tell me my phone battery level.
Hey Jazz, is my phone online?
Hey Jazz, ring my phone.
Hey Jazz, enable lost device mode for my phone.
Hey Jazz, disable lost device mode.
Hey Jazz, recovery status.
```

Normal commands such as opening apps, tapping controls, scrolling, going Home/Back/Recents, notifications, and text entry are **not** recovery intents and continue through the existing Accessibility/ADB path.

## Recovery relay routes

### Device-authenticated routes

```text
POST /android/device/heartbeat
GET  /android/device/commands/next
POST /android/device/commands/:id/result
```

### Owner-authenticated routes

```text
GET  /android/device/status
POST /android/device/refresh
GET  /android/device/location
POST /android/device/ring
POST /android/device/recovery-mode
POST /android/device/camera
GET  /android/device/recovery-photo
```

Every owner route requires the owner bearer token. Device routes additionally require the signed device headers.

## Android-version limitations

Android privacy/security restrictions are intentionally respected.

### Location

Location works only after the owner grants normal Android location permission. The implementation does not silently grant permissions.

Normal mode uses WorkManager, whose periodic minimum is approximately 15 minutes and may be delayed further by Doze/battery optimization. Lost Device Mode uses a visible foreground-service notification and polls approximately every 10 seconds while Android allows the service to run.

### Camera

Recovery camera capture requires all of the following:

- the device was previously paired,
- CAMERA permission was granted,
- the device is unlocked,
- Jazz Android Companion is currently foreground/visible,
- Android allows the camera operation.

If those conditions are not met, Jazz returns `CAMERA_CAPTURE_BLOCKED_BY_ANDROID` instead of attempting a bypass.

The CameraX capture Activity is visible and normal Android camera/privacy indicators remain active. No accessibility trick, root bypass, hidden API, lock-screen bypass, or privacy-indicator bypass is used.

Because modern Android heavily restricts starting camera UI from a locked/background state, **location, online state, battery and ringing are more reliable lost-device features than remote camera capture**.

### Ringing

The ring action uses Android-supported ringtone/alarm APIs. It does not bypass protected Do Not Disturb policy.

## Battery implications

- Normal mode: low impact; periodic WorkManager heartbeat.
- Lost Device Mode: higher battery/mobile-data usage because the foreground service checks the relay about every 10 seconds.
- High-accuracy location is requested only when a location command is executed.
- Camera is activated only for an explicit recovery-photo command and only when Android permits it.

Disable Lost Device Mode after the phone is recovered.

## Tests

Relay health:

```powershell
Invoke-RestMethod https://YOUR-RELAY/health
```

Local recovery proxy:

```powershell
Invoke-RestMethod http://127.0.0.1:8799/health | ConvertTo-Json -Depth 5
```

Status through the local owner proxy:

```powershell
Invoke-RestMethod http://127.0.0.1:8799/api/recovery/status | ConvertTo-Json -Depth 8
```

Location:

```powershell
Invoke-RestMethod http://127.0.0.1:8799/api/recovery/location | ConvertTo-Json -Depth 8
```

Ring:

```powershell
Invoke-RestMethod -Method POST http://127.0.0.1:8799/api/recovery/ring | ConvertTo-Json -Depth 8
```

Camera:

```powershell
Invoke-RestMethod -Method POST -Uri http://127.0.0.1:8799/api/recovery/camera -ContentType application/json -Body '{"camera":"front"}' | ConvertTo-Json -Depth 8
```

## Troubleshooting

### Recovery proxy says `configured=false`

Create `services/recovery-local/.env` from `.env.example` and set the HTTPS relay URL plus owner token, then restart `start-jazz.ps1`.

### Phone shows offline

Check mobile data/Wi-Fi, Android battery optimization, the visible `Jazz Device Recovery active` foreground notification when Lost Device Mode is enabled, and relay health.

### `Unauthorized device`

Make sure the Android Companion pairing token exactly matches `JAZZ_RECOVERY_DEVICE_TOKEN` on the hosted relay.

### `Unexpected device identity`

Copy the current Android Companion recovery device ID and set it as `JAZZ_RECOVERY_DEVICE_ID` on the hosted relay.

### `Stale recovery request`

Make sure the phone's automatic date/time is enabled. Signed recovery requests permit only a small clock skew.

### `CAMERA_CAPTURE_BLOCKED_BY_ANDROID`

This is expected when Android refuses background/locked camera access. Unlock the phone and bring Jazz Android Companion to the foreground if you want to test the authorized recovery-camera flow.

### Command remains queued

If Lost Device Mode was not enabled before the phone went away, normal WorkManager timing can delay command pickup. Once the Companion reconnects and receives the enable-mode command, faster foreground polling can begin if Android permits it.
