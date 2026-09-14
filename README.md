# Jazz AI Assistant

A modular, permission-first personal AI assistant platform for web, Windows, and Android companion control.

## Current capabilities

- Browser voice input using Web Speech Recognition where supported
- Friendly female browser speech output where the device provides a suitable voice
- **Hey Jazz** wake-phrase parsing after the microphone is activated
- Live day-part greeting and UI ambience
- Local profile picture selection
- AI chat scaffold, session memory, and reminders
- Windows ADB bridge for Android control
- Android companion app with user-enabled AccessibilityService
- Explicit confirmation before device commands

## Architecture

```text
🎤 Voice
   ↓
Jazz Web UI
   ↓
Jazz API :8787
   ↓
Windows ADB Bridge :9899 (localhost)
   ↓
ADB port forward
   ↓
Jazz Android Companion :9898 (device localhost)
   ↓
AccessibilityService
   ↓
📱 Phone / 📱 Tablet
```

## Repository layout

```text
apps/
  web/                  React + Vite dashboard
  android-companion/    Android companion + AccessibilityService
services/
  api/                  Local HTTP API on port 8787
  agent/                Agent/tool orchestration
packages/
  core/                 Shared domain types and policies
  tools/                Tool contracts and safe execution
  memory/               Memory interfaces
bridges/
  windows-adb/          Windows ADB transport
  termux/               Legacy Termux bridge
config/                 Runtime configuration examples
docs/
  android-windows-setup.md
knowledge-base/         Local knowledge ingestion area
database/               Database schema/migrations
tests/                  Test suites
infrastructure/         Deployment/dev infrastructure
```

## Run the web dashboard

From the repository root:

```powershell
pnpm install
pnpm --dir services/api dev
```

In a second terminal:

```powershell
pnpm --dir apps/web dev
```

Open `http://localhost:5173`.

## Build the Android companion on Windows

The Android companion uses Android API 34 and can be built with the installed Gradle toolchain:

```powershell
gradle -p apps/android-companion assembleDebug
```

APK:

```text
apps/android-companion/app/build/outputs/apk/debug/app-debug.apk
```

Install with ADB:

```powershell
adb devices -l
adb -s YOUR_DEVICE_SERIAL install -r "apps\android-companion\app\build\outputs\apk\debug\app-debug.apk"
adb -s YOUR_DEVICE_SERIAL shell monkey -p com.gunakarna.jazzassistant 1
```

Then enable **Jazz Accessibility Service** on the Android device. Android requires the user to explicitly enable an accessibility service; the service can then retrieve visible UI nodes and perform permitted global actions and gestures.

## Configure Windows ADB bridge

Set the Android serial and companion token in PowerShell:

```powershell
$env:JAZZ_ANDROID_PHONE_SERIAL="YOUR_PHONE_SERIAL"
$env:JAZZ_ANDROID_PHONE_TOKEN="PHONE_TOKEN"
$env:JAZZ_ANDROID_TABLET_SERIAL="YOUR_TABLET_SERIAL"
$env:JAZZ_ANDROID_TABLET_TOKEN="TABLET_TOKEN"
```

Start the Windows bridge:

```powershell
node bridges\windows-adb\adb-bridge.mjs
```

It listens on `127.0.0.1:9899` and uses ADB `forward` to reach each Android companion on port `9898`. No Termux is required on the phone/tablet.

Detailed setup is in `docs/android-windows-setup.md`.

## Supported Android actions

```text
device_info
open_url
launch_app
home
back
recents
notifications
tap
swipe
click_text
read_screen
```

The bridge is allow-listed and does not provide arbitrary shell execution. Jazz must not bypass Android permissions, lock screens, Play Protect, authentication prompts, or other security controls.

## Voice mode

Use Chrome or Edge. Click the microphone button and speak. Jazz displays an animated listening state, sends the recognized text to the API, and speaks the response using the selected browser speech voice. Temporary speech-recognition network failures are handled without dumping raw `network` errors into the chat.

## Current API endpoints

```text
GET  /health
GET  /api/tools
GET  /api/devices
GET  /api/memory
POST /api/memory
GET  /api/reminders
POST /api/reminders
POST /api/device-command
POST /api/chat
```

## Security

Jazz is permission-first. Device actions require explicit user confirmation in the UI and remain constrained by Android's own permissions and the enabled AccessibilityService.

## Important

The GitHub repository contains the generated architecture/UI scaffold and code added through the connected GitHub session. It is **not** a byte-for-byte copy of your local `C:\Users\gunak\Downloads\Jazz AI Assistant` folder unless that local project is uploaded and synchronized separately.
