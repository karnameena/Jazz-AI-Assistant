# Jazz Lost Mode — Remote Location Services upgrade audit

**Status: audited, not implemented.** This document is an implementation boundary and source map. No APK, web bundle, service endpoint, or on-device location toggle has been built or tested.

## Verified repository paths (2026-10-12)

- `apps/android-companion/app/src/main/java/com/gunakarna/jazzassistant/recovery/RecoveryCommandExecutor.kt`: existing device command allowlist and execution.
- `.../RecoveryNetworkClient.kt`: already-paired device heartbeat, poll `/android/device/commands/next`, and POST command results.
- `.../DeviceLocationManager.kt`: existing fused position acquisition, fallback and history.
- `.../RecoverySecurityManager.kt`: **separate** recovery relay credential flow; do not confuse with Lost Mode credential flow.
- `.../lostmode/LostModeSetupActivity.kt`: owner-facing HTTPS enrollment settings; appropriate place for explicit local opt-in.
- `.../lostmode/LostModeSecurityManager.kt`, `LostModeNetworkClient.kt`: dedicated Lost Mode credentials/transport; inspect and preserve before any implementation.
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
