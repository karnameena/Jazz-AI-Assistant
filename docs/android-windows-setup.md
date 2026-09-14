# Jazz Android Control — Windows + ADB + Accessibility

This is the Windows-only Android control path. It does not require Termux on the phone or tablet.

## Architecture

```text
Windows Jazz API
      |
      v
Windows ADB Bridge :9899 (localhost only)
      |
      | adb forward tcp:19001/19002 -> device tcp:9898
      v
Jazz Android Companion
      |
      v
AccessibilityService
      |
      +-- open_url / launch_app
      +-- home / back / recents / notifications
      +-- tap / swipe / click_text
      +-- read_screen
```

The AccessibilityService must be manually enabled by the device owner. It only exposes the allow-listed commands implemented by the companion.

## 1. Windows prerequisites

Verify ADB:

```powershell
adb version
adb devices
```

Verify Java/Gradle for the Android project:

```powershell
java -version
gradle -v
```

The companion uses Android API 34 and AGP 9.4.0. AGP 9.4 requires Gradle 9.6 or newer, so Gradle 9.7.1 is suitable.

## 2. Build the companion APK

From the repository root:

```powershell
cd "C:\Users\gunak\Downloads\Jazz AI Assistant"
gradle -p apps/android-companion assembleDebug
```

APK output:

```text
apps/android-companion/app/build/outputs/apk/debug/app-debug.apk
```

## 3. Install on the Android phone

Connect the phone by USB and authorize the USB debugging prompt on the phone.

Check the serial:

```powershell
adb devices -l
```

Install:

```powershell
adb -s YOUR_PHONE_SERIAL install -r "apps\android-companion\app\build\outputs\apk\debug\app-debug.apk"
```

Launch the companion:

```powershell
adb -s YOUR_PHONE_SERIAL shell monkey -p com.gunakarna.jazzassistant 1
```

## 4. Enable Accessibility

The companion shows a button to open Accessibility Settings. You can also open the settings from Windows:

```powershell
adb -s YOUR_PHONE_SERIAL shell am start -a android.settings.ACCESSIBILITY_SETTINGS
```

On the phone, enable **Jazz Accessibility Service**.

Android requires the user to explicitly enable an accessibility service. The service can then retrieve visible UI nodes and perform global actions and gestures.

## 5. Get the bridge token

Open **Jazz Android Companion** on the phone. It displays a bridge token and has a Copy Bridge Token button.

Keep the token private.

## 6. Verify the Android command server through ADB

Create the ADB forward:

```powershell
adb -s YOUR_PHONE_SERIAL forward tcp:19001 tcp:9898
```

The Android companion listens only on its own localhost port; ADB forwards the Windows localhost port to it.

## 7. Configure Windows variables

For the phone:

```powershell
$env:JAZZ_ANDROID_PHONE_SERIAL="YOUR_PHONE_SERIAL"
$env:JAZZ_ANDROID_PHONE_TOKEN="PASTE_PHONE_TOKEN_HERE"
$env:JAZZ_ADB_BRIDGE_PORT="9899"
```

For a tablet, install the same companion there and use its own serial/token:

```powershell
$env:JAZZ_ANDROID_TABLET_SERIAL="YOUR_TABLET_SERIAL"
$env:JAZZ_ANDROID_TABLET_TOKEN="PASTE_TABLET_TOKEN_HERE"
```

## 8. Start the Windows ADB bridge

```powershell
cd "C:\Users\gunak\Downloads\Jazz AI Assistant"
node bridges\windows-adb\adb-bridge.mjs
```

Expected:

```text
Jazz Windows ADB bridge listening on 127.0.0.1:9899
```

Test:

```powershell
Invoke-RestMethod http://127.0.0.1:9899/health
```

## 9. Start Jazz API

In a second PowerShell window, configure the same device serial variables, then:

```powershell
cd "C:\Users\gunak\Downloads\Jazz AI Assistant"
pnpm --dir services/api dev
```

The API automatically routes Android commands to the Windows ADB bridge at `http://127.0.0.1:9899`.

## 10. Start the web UI

In a third PowerShell window:

```powershell
cd "C:\Users\gunak\Downloads\Jazz AI Assistant"
pnpm --dir apps/web dev
```

Open:

```text
http://localhost:5173
```

## 11. First safe tests

Check device information from the Windows bridge:

```powershell
$body = @{ deviceId="android-phone"; action="device_info"; args=@{} } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:9899/command -Method POST -ContentType "application/json" -Body $body
```

Open a URL:

```powershell
$body = @{ deviceId="android-phone"; action="open_url"; args=@{ url="https://www.google.com" } } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:9899/command -Method POST -ContentType "application/json" -Body $body
```

## Wireless ADB later

After USB works, Android's Wireless debugging can be used so the phone/tablet does not need to stay physically connected. Pair the device through Developer options and then use the resulting `IP:PORT` as the ADB serial.

## Safety boundary

Jazz does not bypass lock screens, Play Protect, Android permissions, authentication prompts, or other security controls. The bridge has an explicit action allow-list. More advanced operations should be implemented through documented Android APIs and user-enabled accessibility capabilities.
