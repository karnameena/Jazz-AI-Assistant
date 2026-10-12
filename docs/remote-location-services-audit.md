# Jazz Lost Mode — Remote Location Services upgrade audit

**Status: read-only Location Services reporting implemented; remote ON/OFF not implemented.** This document captures the compatibility boundary and changed files. This upgrade does not remotely enable or disable Android's global Location Services setting.

## Additive changes on this branch

- `apps/android-companion/app/src/main/java/com/gunakarna/jazzassistant/recovery/DeviceStatusManager.kt`: reads `LocationManager.isLocationEnabled()` (API 28+) or legacy location mode (API 26–27). Reports ON, OFF or UNKNOWN in the existing device-status snapshot. It never changes settings.
- `services/lost-mode-server/migrations/002_location_service_readback.sql`: adds two nullable-compatible columns to existing `device_state` rows; no changes to existing account or command schema.
- `services/lost-mode-server/src/server.mjs`: persists sanitized ON/OFF/UNKNOWN reports from existing authenticated device heartbeats and status-result messages. Existing owner-authenticated `GET /api/devices/:id` exposes last confirmed status and timestamp. Offline devices show OFFLINE rather than stale ON.
- `apps/lost-mode-web/src/main.tsx`: a separate Location Services status area and refresh action using the existing `DEVICE_STATUS` command, without replacing existing map, ring, photo, or recovery UI.
- `services/lost-mode-server/tests/location-services-readback.test.mjs`: integration tests of owner authentication, readback ON/OFF/UNKNOWN, offline handling and the unchanged ring command.
- `.github/workflows/jazz-lostmode-location-checks.yml`: automated web, backend and Android debug build checks; existing repo lacks Android `gradle-wrapper.jar`, so CI installs a compatible version of Gradle.

These files are **on a separate GitHub branch only** and are not installed on the user's real phone. No Location Services write permission was introduced and no global toggle was activated.

## Deployment / rollback

Deploy the Lost Mode backend branch using its existing environment and database; the additive 002 migration runs on startup. Deploy `apps/lost-mode-web` using its existing Vite build and `VITE_API_BASE_URL`. Update the Android Companion with an APK built from this branch **only after checking signing compatibility**. Uninstalling/reinstalling a differently signed debug APK could erase stored pairing, so never replace the existing installed app blindly.

To roll back the web/mobile code, use the pre-upgrade branch and the existing signed mobile release; do not drop the newly added SQLite columns if existing readback data matters. Do not reset other local branches or delete user Whisper/Piper/paired credential data.


## Verified repository paths (2026-10-12)

- `apps/android-companion/app/src/main/java/com/gunakarna/jazzassistant/recovery/RecoveryCommandExecutor.kt`: existing device command allowlist and execution.
- `.../RecoveryNetworkClient.kt`: already-paired device heartbeat, poll `/android/device/commands/next`, and POST command results.
- `.../DeviceLocationManager.kt`: existing fused position acquisition, fallback and history.
- `.../RecoverySecurityManager.kt`: **separate** recovery relay credential flow; do not confuse with Lost Mode credential flow.
- `.../lostmode/LostModeSetupActivity.kt`: owner-facing HTTPS enrollment settings; appropriate place for explicit local opt-in.
- `.../lostmode/LostModeSecurityManager.kt`, `LostModeNetworkClient.kt`: dedicated Lost Mode credentials/transport. **Verified:** `LostModeNetworkClient.syncOnce()` checks a second client-side allowlist (`device_status`, `device_location`, `ring_device`, `recovery_photo`, `set_recovery_mode`, `play_voice_message`) and delegates allowed operations to `RecoveryCommandExecutor`. Any future command must be included in that allowlist, without weakening the existing list.
- `apps/android-companion/app/src/main/AndroidManifest.xml`: location runtime permissions exist; WRITE_SECURE_SETTINGS is **not** currently declared.
- `apps/android-companion/app/build.gradle.kts`: `applicationId=com.gunakarna.jazzassistant`, min SDK 26, compile/target SDK 34.
- `services/lost-mode-server/src/server.mjs`: **actual authenticated** Lost Mode website API, owner/device authorization, command allowlist, device queue and audit.
- `services/lost-mode-server/migrations/001_initial.sql`: existing devices/commands/audit SQLite schema.
- `apps/lost-mode-web/src/main.tsx`: signed-in React dashboard, selected registered device, existing action POST and update polling.
- `services/api/src/server.mjs`: generic Jazz AI chat API; **not** the website's Lost Mode action API. Avoid adding a parallel recovery control route here.
- `services/recovery-relay/server.mjs`: another separate recovery route; do not change its legacy protocol for this feature.

## Android compatibility boundary

On Android API 28+, `LocationManager.isLocationEnabled()` is the documented way to read the global toggle. On API 26–27 use the older secure setting only to read, not as a guaranteed compatibility claim.

The supported setter on Android 11+ is `DevicePolicyManager.setLocationEnabled(ComponentName,boolean)`, restricted to a **device-owner-managed** app. The user's existing Android Companion is not established as a device owner.

FMD's optional ADB-granted `WRITE_SECURE_SETTINGS` mechanism may work with a secure-setting write on certain builds, but `Settings.Secure.LOCATION_MODE` has been deprecated since API 28 and behavior is OEM/version-dependent. Declaring/granting `WRITE_SECURE_SETTINGS` does not establish a supported universal global ON/OFF setter for a normal app. Any prototype must read the actual global state back, return `UNSUPPORTED`/`PERMISSION_REQUIRED` as appropriate, and never simulate success.

**ADB command for verified package, if supported and explicitly consented:**

```sh
adb shell pm grant com.gunakarna.jazzassistant android.permission.WRITE_SECURE_SETTINGS
```

This requires a manifest declaration in a future build, local owner authorization, and device-specific testing. **Do not run** it against the current APK expecting the permission to exist.

## Necessary future changes (not performed)

1. Android: isolated read-only status helper, explicit default-off owner opt-in UI, supported device-owner setter where applicable; no hidden API or root. ADB special-permission branch only when validated for that OS/OEM and confirmed by readback.
2. Lost Mode server: extend its existing owner-scoped device action allowlist and queue, with expiry, replay/idempotency, stored result and audit. Existing schema may support this using `recovery_commands`; migrations only if essential.
3. Lost Mode web: add a separate location-service status/control panel below existing cards, preserve map/photo/ring actions, and show confirmed state only from a matching command's device result, never POST acceptance.
4. Optional auto-locate must be owner-opted-in, default false, and guarded by verified original-state restoration in `finally`.
5. Tests: server unauthorized cross-account attempts, pending/offline/expiry/duplicate/device result, Android API/OEM permissions, existing recovery regressions, Android Gradle assembleDebug, Vite build and a real enrolled-device test.

## Existing features deliberately unchanged

Pairing, identity and authentication, heartbeat, device_status, device_location, ring, camera, photo, voice messages, WhatsApp, Telegram, Ollama, reminders, service ports and startup scripts.

## Rollback

This work is isolated on branch `feature/jazz-remote-location-services-20261012`, starting from `feature/jazz-intelligence-attachments-20261008`. No changes were merged into an existing deployed or local branch. To ignore this audit, continue using your prior branch; do not delete local Whisper/Piper data or perform a hard reset.
