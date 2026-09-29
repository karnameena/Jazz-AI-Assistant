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
