# Jazz Lost Mode — Location Services remote commands

**Status (2026-10-12): command implementation committed in an isolated draft branch. Backend simulated-device tests and Lost Mode frontend production build passed; Android APK and actual managed-device tests are NOT confirmed.**

## Source-of-truth architecture

- Android application ID: `com.gunakarna.jazzassistant`; compile/target SDK 34, minimum SDK 26.
- Browser: `apps/lost-mode-web/src/main.tsx`; authenticates to `services/lost-mode-server/src/server.mjs`.
- That existing server owns users/devices, session cookies, an authenticated device poll, SQLite `recovery_commands`, results and `recovery_audit`.
- Android: `lostmode/LostModeNetworkClient.kt` polls and accepts a strict allowlist, delegating to `recovery/RecoveryCommandExecutor.kt`. `lostmode/LostModeSetupActivity.kt` manages local opt-in.
- **Do not confuse** `services/api` or `services/recovery-relay` with the Lost Mode website backend. Neither was modified for this feature.

## New functionality

- Global Location Services readback comes from the original DeviceStatusManager, transmitted by the existing authenticated heartbeat. Additive migration `002_location_service_readback.sql` persists ON/OFF/UNKNOWN and timestamp. Offline is presented as OFFLINE, never a stale ON.
- Android managed-device controller `recovery/OwnerLocationController.kt` uses `DevicePolicyManager.setLocationEnabled()` **only if** Android 11+ AND `DevicePolicyManager.isDeviceOwnerApp()` AND the enrolled user explicitly opted in locally. `JazzLocationAdminReceiver` and its XML descriptor are registered in the existing manifest without changing application ID, device channels, port, package, or startup.
- Local opt-in is OFF by default and may be revoked in Lost Mode Setup. There is **no** root, accessibility bypass, shell exec, hidden Android API, or silent device-owner enrollment.
- Existing Companion executor and existing Lost Mode client allowlist include `location_status`, `location_enable`, `location_disable`. Device checks expiry then executes and reads back the actual global state; NO success is reported just because Android accepted a setter call.
- Existing authenticated Lost Mode backend owner action API accepts `LOCATION_STATUS`, `LOCATION_ENABLE`, `LOCATION_DISABLE`. Commands carry existing UUID, created-at and a 120-second expiry. Old pending commands expire without execution; duplicate same commands coalesce; opposite queued toggles get HTTP 409; result replay cannot overwrite the stored result; device identity and logged-in owner are validated.
- New authenticated `GET /api/devices/:deviceDbId/commands/:commandUuid` returns the result of that specific enrolled device's Location Services command. `CONFIRMED` is only reported if the device result is `ok:true` and its global state matches the requested ON/OFF.
- Existing Lost Mode dashboard adds ON/OFF buttons and command progress/status. No optimistic success and no changes to existing map, photo, ring, voice, mode, device selection, or startup workflow.

## Hard compatibility boundary

**Being the purchaser/owner of a phone is different from Android Enterprise device-owner authorization.** The supported Android 11+ `DevicePolicyManager.setLocationEnabled` call works only for a device management application provisioned as *device owner*. Simply installing Jazz, enabling Developer options, or using `adb shell pm grant ... WRITE_SECURE_SETTINGS` **does not** grant this managed-device API authority.

FMD documents an **alternative** ADB-granted `WRITE_SECURE_SETTINGS` route on supported firmware. It is **not implemented in this branch** and should not be represented as a universal fallback: `Settings.Secure.LOCATION_MODE` is deprecated and OEM behavior varies. This upgrade does not add WRITE_SECURE_SETTINGS to the manifest. The remote command will report `DEVICE_OWNER_REQUIRED`, `OPT_IN_REQUIRED`, `UNSUPPORTED`, or `PERMISSION_REQUIRED` if it cannot change the real setting.

Do not try to provision device-owner status on a production/personal mobile if it requires erasing accounts or factory-resetting the device. This is an **optional managed-device setup feature, not a guaranteed remote unlock of location**.

## Tests and build status

- **Passed on GitHub Actions:** Lost Mode backend Node syntax check, owner login/heartbeat/reporting/queue/result integration test including authenticated command polling, duplicates, pending-vs-confirmed, opposite-direction conflict, failed device-owner case, confirmed result, expiry, cross-account denial, unchanged RING_DEVICE command, and Vite Lost Mode web production build.
- **Android APK:** no verified artifact yet. Existing Gradle wrapper JAR is absent in the repo. CI uses preinstalled SDK, Gradle 9.6 with AGP 9.4 and a compatibility flag for the existing generated Jazz icon; Maven dependency resolution on the runner has failed. No APK should be claimed unless an actual debug assembly succeeds.
- **Phone:** no owner-enrolled physical Android phone or ADB device was connected. The real global toggle, Android OEM behavior, and on-lock-screen delivery remain unverified.

## Building and deployment

In a local clone with the required Android SDK, Java 17 and working Gradle 9.6 installation:

```powershell
cd apps/android-companion
gradle :app:assembleDebug --no-daemon -Pandroid.sourceset.disallowProvider=false
```

A successful build produces `app/build/outputs/apk/debug/app-debug.apk`. **Do not replace an installed differently signed Jazz APK**: uninstalling can erase paired Lost Mode credentials. Use the same signing key or test on a separate managed test device.

Build website from the repository root with `pnpm --filter @jazz/lost-mode-web build` and deploy using its existing `VITE_API_BASE_URL`. Deploy `services/lost-mode-server` using existing HTTPS, sessions, credentials, persistence and migrations. The application will automatically apply migration 002 on startup. Do not point the website to the general Jazz AI API on port 8797.

After enrolling and provisioning an eligible Android Enterprise managed device, opt into remote Location controls from Companion → Jazz Lost Mode Setup, then sign into the existing website. Click Refresh Status, Turn ON Location, then Turn OFF Location; check that only the specific UUID's confirmed result updates the status. Verify old Ring, camera, Get Location and recovery workflows.

## Rollback

Original functioning branch: `feature/jazz-intelligence-attachments-20261008`.
Read-only backup checkpoint: `backup/jazz-location-status-20261012`.
Work branch: `feature/jazz-remote-location-services-20261012`.
Not merged or deployed. To roll back, keep the original branch and existing signed Android build, website and server. SQLite's added readback columns can remain unused. Never reset/remove local data, pairing secrets or Whisper/Piper assets.

**Default-off optional auto-locate/restore** is NOT implemented; existing Locate Device continues unmodified.
