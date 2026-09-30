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
- `PLAY_VOICE_MESSAGE` (bounded 16 kHz mono PCM WAV only)

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

## Remote voice broadcast

The Lost Mode website can record a short owner voice message in the browser and send it to the selected enrolled device.

- The browser requests microphone permission only after the owner presses **Record voice**.
- Recording is limited to 20 seconds and converted locally to 16 kHz mono PCM WAV.
- The owner can preview the recording before sending it.
- The server accepts only the authenticated `PLAY_VOICE_MESSAGE` action, validates the WAV format and size, and queues it through the same recovery command table used by the existing buttons.
- `LostModeNetworkClient` accepts only the explicit `play_voice_message` command type and delegates it to `RecoveryCommandExecutor`.
- Android decodes the bounded WAV, plays it with alarm/speech audio attributes, temporarily raises the alarm stream to maximum volume where Android permits it, and restores the previous volume after playback.
- The browser recording is kept only in memory until it is sent, discarded, the panel is closed, the selected device changes, or the page is left.
- No Whisper/STT service is required. Voice broadcast is audio delivery, not command transcription.

Browser microphone capture requires HTTPS in production (localhost is allowed for development). Android/OEM audio policy can still affect actual loudness or playback behavior, so physical-device testing is required before relying on it for recovery.

## Validation before merge

Run:

```powershell
pnpm --filter @jazz/lost-mode-web build
pnpm --filter @jazz/web build
cd apps/android-companion
./gradlew assembleDebug
```

Then verify both the original Jazz recovery path and the new Lost Mode path before merging this branch. For voice broadcast, test record -> preview -> send -> loud playback on the selected physical Android device, then confirm the previous alarm volume is restored.
