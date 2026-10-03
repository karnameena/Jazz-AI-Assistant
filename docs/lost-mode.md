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

The database and WAL files are ignored by Git. The schema is created by migrations. SQLite foreign keys, WAL mode, busy timeout and secure-delete are enabled by the service.

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

## Hosted web + API

The Vite development server proxies `/api` locally. A static production build does not have that development proxy.

`apps/lost-mode-web` now supports an optional build-time `VITE_API_BASE_URL`. If the browser is going to call the API directly, set it to the hosted HTTPS Lost Mode server origin before building the static site. Do not put any secret in a `VITE_*` variable because Vite bakes those values into the public browser bundle.

### Preferred Render setup

For a Render Static Site, the preferred setup is to keep browser authentication same-origin:

1. Leave `VITE_API_BASE_URL` blank.
2. In the Lost Mode Static Site, add a **Rewrite** rule:
   - Source: `/api/*`
   - Destination: `https://YOUR-LOST-MODE-SERVER.onrender.com/api/*`
3. On the Lost Mode server set:
   - `LOST_MODE_PUBLIC_ORIGINS=https://YOUR-LOST-MODE-WEB.onrender.com`
   - `LOST_MODE_COOKIE_SECURE=true`
   - `LOST_MODE_COOKIE_SAMESITE=None`
   - `LOST_MODE_TRUST_PROXY=true`
4. Redeploy the server and then redeploy the static site.

The same-origin rewrite avoids relying on third-party browser cookies. Direct cross-origin API mode remains supported when `VITE_API_BASE_URL` is set; CORS is an exact allowlist and never uses `*` with credentials.

For the Render Static Site, configure response headers for `/*` such as:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(self), microphone=(self), geolocation=()`
- `Cross-Origin-Opener-Policy: same-origin`

Test a Content-Security-Policy against the deployed site before enforcing it because the map iframe and browser-recorded blob audio must be explicitly allowed.

## Browser credential handling

The login form does not store the username or password in React state, localStorage, sessionStorage, query parameters or application logs. The password field is cleared immediately after the request body is serialized.

A browser cannot make a password invisible to its own user or developer tools while the user is actively typing it: the browser must hold the current field value in memory to submit it. Security comes from HTTPS, avoiding persistent client-side secret storage, an HttpOnly server session cookie, exact-origin checks and server-side password hashing. Never embed real credentials in HTML, JavaScript, Vite variables or source control.

If a real password is accidentally pasted into chat, screenshots, logs or source code, rotate it immediately.

## Android enrollment

Open **Jazz Android Companion** and tap **Open New Lost Mode Website Setup**.

Enter:

1. hosted HTTPS Lost Mode server URL,
2. device ID printed by `pnpm lost-mode:create-device`,
3. one-time device credential printed by that command.

The credential is encrypted with Android Keystore before being stored locally. The original existing Jazz recovery credentials are not replaced.

## Offline behaviour

Each authenticated heartbeat updates SQLite with battery, network, Lost Mode state, last-seen time and last known location. If the phone powers off or loses connectivity, the website marks it offline after the online window but keeps the last persisted values. When Android boots again, `LostModeBootReceiver` schedules a fresh sync through WorkManager.

## Sessions and authentication

Lost Mode browser login uses a short-lived opaque server session. Only a SHA-256 hash of the session token is stored in SQLite. Production cookies are host-only, HttpOnly and Secure; the service uses the `__Host-` cookie prefix in secure mode. SameSite can be configured for the hosting topology. Session expiry comparisons use SQLite date parsing so ISO timestamps expire correctly.

Login failures are rate-limited by both username and source address, successful login clears the failure bucket, and nonexistent usernames still perform a dummy scrypt verification to reduce username timing leakage.

Android device credentials remain scrypt protected in SQLite. Successful device authentication is cached only as a short-lived in-memory SHA-256 token fingerprint keyed to the current credential hash, reducing repeated scrypt cost during fast polling without storing the raw credential or weakening credential rotation.

## Recovery queue safety

Rapid duplicate requests for device status, location and the same recovery-photo camera are coalesced instead of creating duplicate pending commands. Front and rear camera requests remain distinct. The server also caps the number of pending recovery commands per device to prevent accidental or abusive queue growth.

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

Then verify both the original Jazz recovery path and the new Lost Mode path before merging this branch. For hosted validation, test login -> session restore -> device list -> location -> front photo -> back photo -> logout in a private browser window. For voice broadcast, test record -> preview -> send -> loud playback on the selected physical Android device, then confirm the previous alarm volume is restored.
