# Jazz Lost Mode / Device Recovery

This feature is additive. The existing Jazz API, recovery-local service, recovery-relay, ADB flow, Accessibility flow, voice flow, coding agent and existing Android recovery handlers remain available independently.

## Architecture

Borrowed browser -> `apps/lost-mode-web` -> `services/lost-mode-server` -> SQLite -> authenticated Lost Mode Android channel -> existing `RecoveryCommandExecutor` -> existing recovery managers.

The public Lost Mode allowlist is limited to:

- `DEVICE_STATUS`
- `GET_LOCATION`
- `RING_DEVICE`
- `RECOVERY_PHOTO` (`front` or `rear`)
- `SET_RECOVERY_MODE`

No shell, ADB shell, PowerShell, arbitrary script or coding-agent command is exposed.

## Local database

SQLite file (default):

`services/lost-mode-server/data/lost-mode.db`

The database and WAL files are ignored by Git. The schema is created by migrations.

## Setup

From the repository root:

```powershell
pnpm install
pnpm lost-mode:migrate
pnpm lost-mode:create-owner
pnpm lost-mode:create-device
```

`create-owner` stores only a scrypt password hash. `create-device` stores only a credential hash and prints the raw device credential once.

Copy `services/lost-mode-server/.env.example` to `.env` only on the server and configure values there. Do not commit `.env`.

Start the Lost Mode backend:

```powershell
pnpm lost-mode:server
```

Start the Lost Mode website:

```powershell
pnpm lost-mode:web
```

Local development defaults:

- web: `http://localhost:5190`
- backend: `http://127.0.0.1:8890`

Production Android enrollment requires an HTTPS Lost Mode server URL.

## Android enrollment

Open **Jazz Android Companion** and tap **Open New Lost Mode Website Setup**.

Enter:

1. hosted HTTPS Lost Mode server URL,
2. device ID printed by `pnpm lost-mode:create-device`,
3. one-time device credential printed by that command.

The credential is encrypted with Android Keystore before being stored locally. The original existing Jazz recovery credentials are not replaced.

## Offline behaviour

Each authenticated heartbeat updates SQLite with battery, network, Lost Mode state, last-seen time and last known location. If the phone powers off or loses connectivity, the website marks it offline after the online window but keeps the last persisted values. When Android boots again, `LostModeBootReceiver` schedules a fresh sync through WorkManager.

## Sessions

Lost Mode browser login uses a short-lived opaque server session. Only a SHA-256 hash of the session token is stored in SQLite. The browser receives the raw value only in an HttpOnly, SameSite=Strict cookie. There is no permanent Remember Me state and no auth secret is stored in localStorage.

## Validation before merge

Run:

```powershell
pnpm --filter @jazz/lost-mode-web build
pnpm --filter @jazz/web build
cd apps/android-companion
./gradlew assembleDebug
```

Then verify both the original Jazz recovery path and the new Lost Mode path before merging this branch.

## Optional browser voice input

Select a device and open **Voice Input** alongside the existing recovery actions.
The panel starts closed and never requests microphone permission until **Start
recording** is clicked. Use HTTPS on a hosted site, or localhost for development;
ordinary HTTP LAN addresses do not support browser microphone access.

- **Voice command:** record up to 30 seconds, stop, review/edit the transcript,
  and click **Confirm command**. Confirmation calls the exact same `action()`
  function and `/api/devices/:id/actions` endpoint as the existing buttons.
- The six supported commands are device status, location, ring, front photo,
  back photo, and enable Lost Mode. Say one command at a time, e.g. “Hey Jazz,
  get my phone location.” Unknown, negative, and multiple instructions do not
  match the strict command parser. Voice never bypasses the server allowlist.
- **Audio message:** record, preview, download, or share through the browser's
  native file share sheet when supported. Otherwise use Download audio. This
  records the browser user's microphone; it does not record the lost phone's
  microphone or send/play a message on that phone. No new Android action is added.
- Closing the panel, switching selected devices, logging out, hiding the tab,
  or leaving the page stops recording and clears the in-memory draft. There is
  no automatic listening, browser speech-service fallback, or localStorage audio.
  Sharing opens the user's share sheet; only its selected destination receives
  the audio file. Downloaded/shared files remain with their chosen destination.

### Enable local transcription

Audio-message recording and typed command review need no STT setup. Voice
transcription is opt-in and uses the existing `services/stt/server.mjs` Whisper
service, which must already have its CLI/model installed. In the **Lost Mode
server's process environment**, set `LOST_MODE_STT_URL` to that service's private
base URL. For the same Windows machine:

```powershell
# Terminal 1: existing local Whisper service (if not already started by Jazz)
node services/stt/server.mjs

# Terminal 2: Lost Mode backend
$env:LOST_MODE_STT_URL = "http://127.0.0.1:8798"
pnpm lost-mode:server
```

The current server start script does not automatically load `.env` files; set
variables in the process or hosting environment. A hosted Lost Mode backend's
`127.0.0.1` refers to that host, not your Windows PC. Use a private reachable STT
service or leave transcription disabled; no public unauthenticated STT tunnel
is required. Existing recovery remains independent of transcription availability.

The new `/api/voice/config` and `/api/voice/transcribe` routes require the existing
owner session. The adapter accepts bounded mono PCM WAV input, enforces one
transcription at a time and a timeout, and returns the raw transcript for review.
It adds no database tables, commands, credentials, or paid service dependency.
The adapter does not persist audio/transcripts. The reused STT service retains
its existing temporary-file cleanup and console logging behavior.

### Voice validation

With Node 24+, run `node --test apps/lost-mode-web/tests/*.test.mjs
services/lost-mode-server/tests/voice.test.mjs`, then build the Lost Mode frontend.
Check microphone allow/deny, Stop/Cancel, review and confirmation, all six
commands, multiple/unknown instructions, device switching, logout, disabled or
unavailable STT, and audio preview/download/share on the intended browsers.
