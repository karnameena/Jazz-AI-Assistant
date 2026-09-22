# Jazz AI Assistant

Jazz is a Windows-first, local-first personal AI assistant with a React web UI, local Ollama LLM, local Whisper speech-to-text, Piper text-to-speech, Android control through ADB, registered local automation scripts, and an optional Telegram popup integration.

This README is the main A-to-Z setup guide for a fresh Windows machine.

> **Do not commit private `.env` files, device tokens, Telegram sessions, API keys, PINs, passwords, or payment credentials.** The repository already ignores real `.env` files and allows only `.env.example` templates.

---

## Table of contents

1. [What Jazz runs](#what-jazz-runs)
2. [Architecture and ports](#architecture-and-ports)
3. [Repository layout](#repository-layout)
4. [Prerequisites](#prerequisites)
5. [Clone and install](#clone-and-install)
6. [Configure Android ADB](#configure-android-adb)
7. [Create the Windows ADB bridge `.env`](#create-the-windows-adb-bridge-env)
8. [API `.env` and local AI settings](#api-env-and-local-ai-settings)
9. [Install Ollama](#install-ollama)
10. [Install local Whisper STT](#install-local-whisper-stt)
11. [Install Piper TTS](#install-piper-tts)
12. [Build and install the Android companion](#build-and-install-the-android-companion)
13. [Start Jazz](#start-jazz)
14. [Verify every service](#verify-every-service)
15. [Voice conversation](#voice-conversation)
16. [Registered script commands](#registered-script-commands)
17. [Adding your own registered script](#adding-your-own-registered-script)
18. [Telegram integration](#telegram-integration)
19. [Manual development mode](#manual-development-mode)
20. [Troubleshooting](#troubleshooting)
21. [Security rules](#security-rules)

---

## What Jazz runs

Current major components:

- **React + Vite web UI** on port `5173`
- **Jazz API** on port `8797` when started with `start-jazz.ps1`
- **Ollama** local LLM on port `11434`
- **Local Whisper / whisper.cpp STT** on port `8798`
- **Piper TTS** for local spoken replies
- **Windows ADB bridge** on `127.0.0.1:9899`
- **Jazz Android Companion** on Android localhost port `9898`
- **ADB forwards** Windows ports `19001` / `19002` to Android port `9898`
- **Registered PowerShell/Bash scripts** from `scripts/android`
- **Optional Telegram popup** inside the Jazz web dashboard

The managed launcher is the recommended way to run the project because it starts services in the correct order, clears stale listeners, verifies health, repairs Piper/Whisper when required, and starts Vite with the expected ports.

---

## Architecture and ports

```text
                     ┌─────────────────────────────┐
                     │     Browser / Jazz UI       │
                     │     http://localhost:5173   │
                     └──────────────┬──────────────┘
                                    │
                  text / commands   │   mic audio
                                    │
                     ┌──────────────▼──────────────┐
                     │       Jazz API :8797        │
                     └───────┬───────────┬─────────┘
                             │           │
                        chat │           │ Android scripts/actions
                             │           │
                  ┌──────────▼───┐   ┌──▼────────────────────┐
                  │ Ollama :11434│   │ Windows ADB :9899     │
                  │ local LLM    │   │ localhost only        │
                  └──────────────┘   └──────────┬────────────┘
                                               │ adb forward
                                               │
                                     ┌─────────▼─────────┐
                                     │ Android Companion │
                                     │ device :9898      │
                                     └─────────┬─────────┘
                                               │
                                     AccessibilityService

Browser microphone
       │
       ▼
Vite /stt-local proxy
       │
       ▼
Whisper STT :8798

Jazz reply
       │
       ▼
Piper TTS
       │
       ▼
Speaker + voice orb animation
```

### Port reference

| Service | Port | Binding / purpose |
|---|---:|---|
| Jazz Web | `5173` | Vite dashboard |
| Jazz API | `8797` | Managed local API |
| Local STT | `8798` | whisper.cpp transcription |
| Windows ADB bridge | `9899` | `127.0.0.1` only |
| Ollama | `11434` | Local LLM |
| Phone ADB forward | `19001` | Windows → phone `9898` |
| Tablet ADB forward | `19002` | Windows → tablet `9898` |
| Android companion | `9898` | Device localhost |

> The API source itself has a development fallback port, but the managed `start-jazz.ps1` launcher always uses **8797**. Use the launcher unless you specifically need manual development mode.

---

## Repository layout

```text
Jazz-AI-Assistant/
├─ apps/
│  ├─ web/                         React + Vite dashboard
│  └─ android-companion/           Android companion application
├─ bridges/
│  ├─ windows-adb/                 Windows ADB bridge
│  │  ├─ adb-bridge.mjs
│  │  ├─ .env.example
│  │  └─ .env                     LOCAL ONLY - never commit
│  └─ termux/                      Termux-related bridge work
├─ services/
│  ├─ api/                         Jazz API, Ollama routing, TTS, scripts
│  │  ├─ .env.example
│  │  ├─ telegram.env.example
│  │  └─ src/
│  ├─ stt/                         Local whisper.cpp HTTP service
│  └─ agent/                       Agent/tool orchestration
├─ packages/
│  ├─ core/
│  ├─ memory/
│  └─ tools/
├─ scripts/
│  └─ android/                     Registered owner-approved scripts
├─ tools/
│  ├─ piper/                       Piper runtime + voices
│  └─ whisper/                     whisper.cpp runtime + model
├─ docs/
│  └─ android-windows-setup.md
├─ .jazz/                          Generated local logs/runtime state
├─ start-jazz.ps1                  Recommended launcher
└─ repair-jazz-runtime.ps1         Runtime/source repair helper
```

---

## Prerequisites

Recommended Windows setup:

- Windows 10 or Windows 11
- PowerShell
- Git
- Node.js 22 or another modern supported Node version
- pnpm `12.3.4` (the repository pins this version)
- Android Platform Tools / `adb.exe`
- Ollama
- Chrome or Edge
- Java 21 + compatible Gradle only if you want to build the Android app yourself

Verify the important commands:

```powershell
node --version
pnpm --version
git --version
adb version
ollama --version
```

If pnpm is missing:

```powershell
npm install -g pnpm@12.3.4
```

---

## Clone and install

```powershell
git clone https://github.com/karnameena/Jazz-AI-Assistant.git
cd Jazz-AI-Assistant
pnpm install
```

The workspace explicitly allows only the required `esbuild` dependency build script. If the dependency tree becomes corrupted or React/Vite starts using stale cached modules, use the included repair script instead of manually deleting random files:

```powershell
powershell -ExecutionPolicy Bypass -File ".\repair-jazz-runtime.ps1"
```

---

## Configure Android ADB

### 1. Enable developer options

On Android:

1. Open **Settings → About phone**.
2. Tap **Build number** repeatedly until Developer options are enabled.
3. Open **Developer options**.
4. Enable **Wireless debugging** or **USB debugging**.

### 2. USB test

Connect by USB and run:

```powershell
adb devices
```

Authorize the debugging prompt on the phone.

### 3. Wireless ADB

From Android **Wireless debugging**, use **Pair device with pairing code**.

Windows example:

```powershell
adb pair PHONE_IP:PAIRING_PORT
```

Enter the pairing code shown on Android.

Then connect using the separate Wireless debugging connection port:

```powershell
adb connect PHONE_IP:CONNECT_PORT
adb devices
```

Typical output can look like:

```text
List of devices attached
192.168.1.50:42069                                  device
adb-XXXXXXXXXXXX-abc123._adb-tls-connect._tcp      device
```

Seeing both an `IP:PORT` transport and an `_adb-tls-connect._tcp` transport can happen with Wireless debugging. For `JAZZ_ANDROID_PHONE_SERIAL`, normally use the working `IP:PORT` shown by `adb devices`. Jazz also contains reconnect and mDNS discovery logic for recovering the transport when possible.

Do not copy a sample IP literally. Use the value shown on **your own device/network**.

---

## Create the Windows ADB bridge `.env`

This is the most important `.env` for Android control.

The launcher loads:

```text
bridges/windows-adb/.env
```

A safe template is committed at:

```text
bridges/windows-adb/.env.example
```

Create your private file:

```powershell
Copy-Item ".\bridges\windows-adb\.env.example" ".\bridges\windows-adb\.env"
notepad ".\bridges\windows-adb\.env"
```

### `.env` syntax rules

Write one variable per line:

```dotenv
KEY=value
ANOTHER_KEY=value
```

Do **not** write PowerShell syntax inside an `.env` file:

```text
# WRONG inside .env
$env:KEY="value"
```

Use quotes only when helpful, such as a path containing spaces:

```dotenv
JAZZ_BASH_PATH="C:\Program Files\Git\bin\bash.exe"
```

### Complete phone example

```dotenv
# Full adb.exe path
ADB_PATH=C:\Users\YOUR_NAME\Downloads\platform-tools\adb.exe

# Jazz bridge
JAZZ_ADB_BRIDGE_PORT=9899
JAZZ_ADB_RECONNECT_INTERVAL_MS=10000

# Phone connection from `adb devices`
JAZZ_ANDROID_PHONE_SERIAL=192.168.1.50:42069

# Copy this from your Jazz Android Companion app
JAZZ_ANDROID_PHONE_TOKEN=PASTE_YOUR_PRIVATE_PHONE_TOKEN_HERE

# Tablet is optional
JAZZ_ANDROID_TABLET_SERIAL=
JAZZ_ANDROID_TABLET_TOKEN=

# Script engines
JAZZ_POWERSHELL_PATH=powershell.exe
JAZZ_BASH_PATH="C:\Program Files\Git\bin\bash.exe"
```

### Where the token comes from

Open **Jazz Android Companion** on the phone. The companion exposes its local bridge token. Copy that value into:

```dotenv
JAZZ_ANDROID_PHONE_TOKEN=YOUR_REAL_TOKEN
```

Never put the real token in GitHub, screenshots, public logs, or README examples.

### Test the bridge `.env` manually

Normally `start-jazz.ps1` starts the bridge for you. For a direct test only:

```powershell
node --env-file=".\bridges\windows-adb\.env" ".\bridges\windows-adb\adb-bridge.mjs"
```

Expected:

```text
Jazz Windows ADB bridge listening on 127.0.0.1:9899
```

If you receive `EADDRINUSE 127.0.0.1:9899`, another Jazz bridge is already running. Do not start a second copy.

---

## API `.env` and local AI settings

Template:

```text
services/api/.env.example
```

Create a private copy only when you need manual API development or Telegram settings:

```powershell
Copy-Item ".\services\api\.env.example" ".\services\api\.env"
notepad ".\services\api\.env"
```

### Important managed-launcher behavior

`start-jazz.ps1` intentionally **does not load `services/api/.env` into the managed API process**. This protects the normal Jazz startup from stale API/provider/Piper overrides.

The managed launcher forces the core runtime to:

```text
API port       = 8797
LLM provider   = ollama
Ollama fallback= enabled
Piper prewarm  = launcher-managed
```

The `services/api/.env` file is still useful for:

- manual API development
- Telegram popup configuration
- documenting optional Ollama/Piper/Whisper overrides

### Example local API `.env`

```dotenv
PORT=8797
JAZZ_ADB_BRIDGE_URL=http://127.0.0.1:9899

JAZZ_LLM_PROVIDER=ollama
JAZZ_OLLAMA_URL=http://127.0.0.1:11434
JAZZ_OLLAMA_MODEL=
JAZZ_OLLAMA_FALLBACK_MODEL=qwen2.5:7b
JAZZ_OLLAMA_AUTOSTART=true
JAZZ_OLLAMA_FALLBACK=true
JAZZ_OLLAMA_BIN=ollama
JAZZ_OLLAMA_TEMPERATURE=0.45
JAZZ_OLLAMA_TIMEOUT_MS=120000

JAZZ_STT_PORT=8798
JAZZ_WHISPER_THREADS=4

JAZZ_PIPER_PREWARM=false
JAZZ_PIPER_LENGTH_SCALE=0.88
```

When `JAZZ_OLLAMA_MODEL` is empty, Jazz currently prefers installed models in this order:

```text
qwen3:8b
qwen3:1.7b
qwen3:0.6b
qwen2.5:7b
then another installed model if necessary
```

---

## Install Ollama

Install Ollama for Windows, then verify:

```powershell
ollama --version
```

Recommended model:

```powershell
ollama pull qwen3:8b
```

You can keep smaller models installed too:

```powershell
ollama pull qwen3:1.7b
ollama pull qwen3:0.6b
```

Check installed models:

```powershell
ollama list
```

Check the HTTP service:

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags | ConvertTo-Json -Depth 6
```

`start-jazz.ps1` can start `ollama serve` automatically when Ollama is installed but not already listening.

---

## Install local Whisper STT

Jazz uses local `whisper.cpp` as its primary microphone transcription engine. Browser speech recognition can remain as a fallback.

The managed launcher checks for:

```text
tools/whisper/runtime/whisper-cli.exe
tools/whisper/models/ggml-base.en-q5_1.bin
```

If missing, `start-jazz.ps1` automatically runs:

```powershell
powershell -ExecutionPolicy Bypass -File ".\tools\whisper\setup-windows.ps1"
```

Manual setup is also allowed:

```powershell
powershell -ExecutionPolicy Bypass -File ".\tools\whisper\setup-windows.ps1"
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8798/health | ConvertTo-Json -Depth 6
```

Expected fields include:

```text
ok      : true
engine  : whisper.cpp
local   : true
language: en
```

Optional STT environment variables:

```dotenv
JAZZ_STT_PORT=8798
JAZZ_STT_MAX_AUDIO_BYTES=12582912
JAZZ_WHISPER_THREADS=4
# JAZZ_WHISPER_BIN=C:\custom\whisper-cli.exe
# JAZZ_WHISPER_MODEL=C:\custom\model.bin
```

---

## Install Piper TTS

Jazz uses Piper for local text-to-speech.

Run:

```powershell
powershell -ExecutionPolicy Bypass -File ".\tools\piper\setup-windows.ps1"
```

The expected runtime is:

```text
tools/piper/runtime/piper.exe
tools/piper/runtime/*.dll
tools/piper/runtime/espeak-ng-data/
tools/piper/voices/en_US-amy-medium.onnx
```

The launcher performs a real synthesis test before reporting Piper as ready.

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8797/api/tts-health | ConvertTo-Json -Depth 6
```

Healthy Windows output should report approximately:

```text
ok               = true
filesReady       = true
runtimeComplete  = true
runtimeDllCount  > 0
executable       = ...\tools\piper\runtime\piper.exe
modelFound       = true
espeakDataFound  = true
```

Optional overrides:

```dotenv
JAZZ_PIPER_LENGTH_SCALE=0.88
JAZZ_PIPER_PREWARM=false
# JAZZ_PIPER_ROOT=C:\custom\piper
# JAZZ_PIPER_BIN=C:\custom\piper\piper.exe
# JAZZ_PIPER_MODEL=C:\custom\voice.onnx
# JAZZ_PIPER_ESPEAK_DATA=C:\custom\espeak-ng-data
```

---

## Build and install the Android companion

The Android app currently uses:

```text
applicationId: com.gunakarna.jazzassistant
compileSdk: 34
minSdk: 26
targetSdk: 34
JVM toolchain: 21
```

With Java/Gradle configured, build from the repository root:

```powershell
gradle -p apps/android-companion assembleDebug
```

APK output:

```text
apps/android-companion/app/build/outputs/apk/debug/app-debug.apk
```

Install:

```powershell
adb devices
adb -s YOUR_DEVICE_SERIAL install -r ".\apps\android-companion\app\build\outputs\apk\debug\app-debug.apk"
```

Launch:

```powershell
adb -s YOUR_DEVICE_SERIAL shell monkey -p com.gunakarna.jazzassistant 1
```

Then manually enable **Jazz Accessibility Service** on the Android device.

Open Accessibility Settings from ADB if needed:

```powershell
adb -s YOUR_DEVICE_SERIAL shell am start -a android.settings.ACCESSIBILITY_SETTINGS
```

Android requires the device owner to enable the accessibility service themselves.

---

## Start Jazz

This is the recommended command:

```powershell
cd C:\path\to\Jazz-AI-Assistant
powershell -ExecutionPolicy Bypass -File ".\start-jazz.ps1"
```

The launcher currently does the following:

1. Stops stale Jazz Node/Vite listeners.
2. Starts the Jazz API on `8797`.
3. Checks/starts Ollama.
4. Installs/checks local Whisper and starts STT on `8798`.
5. Loads `bridges/windows-adb/.env` and starts the ADB bridge on `9899`.
6. Repairs/checks Piper and performs a real TTS synthesis test.
7. Clears Vite caches and starts the web UI on `5173`.

Typical healthy startup contains lines similar to:

```text
Jazz API READY: version=0.10.0-local, provider=ollama, port=8797
Ollama ready: qwen3:8b, ...
Local Whisper STT READY on port 8798
ADB bridge READY on port 9899
Piper TTS READY: ...\tools\piper\runtime\piper.exe
Jazz startup completed.
```

Open:

```text
http://localhost:5173/
```

---

## Verify every service

### API

```powershell
Invoke-RestMethod http://127.0.0.1:8797/health | ConvertTo-Json -Depth 6
```

### Android bridge

```powershell
Invoke-RestMethod http://127.0.0.1:9899/health | ConvertTo-Json -Depth 6
```

### Connected Android devices

```powershell
Invoke-RestMethod http://127.0.0.1:9899/devices | ConvertTo-Json -Depth 8
```

### Ollama

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags | ConvertTo-Json -Depth 6
```

### Whisper STT

```powershell
Invoke-RestMethod http://127.0.0.1:8798/health | ConvertTo-Json -Depth 6
```

### Piper

```powershell
Invoke-RestMethod http://127.0.0.1:8797/api/tts-health | ConvertTo-Json -Depth 6
```

### Browser

Open:

```text
http://localhost:5173/
```

Allow microphone permission when prompted.

---

## Voice conversation

Normal local voice flow:

```text
You speak
   ↓
Browser microphone
   ↓
Local Whisper STT
   ↓
Recognized text
   ↓
Jazz API
   ↓
Registered local command OR Ollama
   ↓
Jazz reply
   ↓
Piper TTS
   ↓
Speaker
```

Examples:

```text
Hey Jazz, what is JavaScript closure?
Hey Jazz, open Instagram.
Hey Jazz, unlock mobile.
```

The UI voice orb/waves react while Jazz is listening or speaking.

If the browser says microphone access is blocked, enable microphone permission for the Jazz site in Chrome/Edge and reload.

---

## Registered script commands

Jazz has an explicit script registry. Natural-language phrases are matched **before** they are sent to Ollama.

This prevents known local commands from being treated as normal AI conversation.

### Current registered script names

```text
unlockmobile
paymom
instagram
youtube
screenshot
```

The Windows bridge checks only allow-listed filenames.

### Unlock command

Examples:

```text
unlock mobile
unlock my mobile
unlock my phone
unlock phone
```

These route to:

```text
scripts/android/unlockmobile.ps1
```

The phrase should trigger the registered script itself. The committed script wakes the device through ADB and leaves normal PIN/biometric authentication on the phone.

### Payment workflow command

Examples:

```text
pay mom
pay mom 1 rupee
pay 1 rupee to mom
send 1 rupee to mom
```

The bridge checks these local filenames in order:

```text
scripts/android/pay-mom.ps1
scripts/android/Payto_Mom.ps1
scripts/android/paymom.ps1
scripts/android/paymom.sh
```

The repository does not need to contain your private payment automation. A local owner-managed script can stay only on your PC under `scripts/android`.

When Jazz launches a registered script, the bridge makes these environment values available to the script:

```text
ADB_PATH
JAZZ_DEVICE_ID
JAZZ_ANDROID_SERIAL
JAZZ_ANDROID_PHONE_SERIAL
JAZZ_ANDROID_TABLET_SERIAL
JAZZ_SCRIPT_ARGS
JAZZ_PAYMENT_AMOUNT   # when Jazz extracted an amount
```

Example inside a local PowerShell script:

```powershell
$serial = $env:JAZZ_ANDROID_SERIAL
$amount = $env:JAZZ_PAYMENT_AMOUNT
$argsJson = $env:JAZZ_SCRIPT_ARGS

Write-Host "Device: $serial"
Write-Host "Amount: $amount"
Write-Host "Jazz args: $argsJson"
```

Never hard-code a banking password, UPI PIN, device PIN, Telegram session, bridge token, or another secret into a script that will be committed to GitHub.

---

## Adding your own registered script

Jazz does not execute arbitrary filenames supplied by an LLM. New automation must be explicitly registered.

General process:

1. Put the owner-approved `.ps1` or `.sh` file under:

```text
scripts/android/
```

2. Add the natural-language aliases to:

```text
services/api/src/script-registry.mjs
```

3. Add the allowed filename to `registeredScriptFiles` in:

```text
bridges/windows-adb/adb-bridge.mjs
```

4. Restart Jazz:

```powershell
powershell -ExecutionPolicy Bypass -File ".\start-jazz.ps1"
```

5. Test the API before relying on the voice UI:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8797/api/chat" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"message":"YOUR REGISTERED PHRASE"}' |
ConvertTo-Json -Depth 8
```

If a known command receives a generic Ollama answer instead of running the registered workflow, the phrase was not matched or the running API is stale. Restart the managed launcher after pulling the latest source.

---

## Telegram integration

Jazz has an optional Telegram popup in the web dashboard. Telegram configuration is separate from normal Jazz chat and Android automation.

Template:

```text
services/api/telegram.env.example
```

Values are placed privately in:

```text
services/api/.env
```

Example:

```dotenv
JAZZ_TELEGRAM_BOT_USERNAME=your_bot_username
JAZZ_TELEGRAM_BOT_TOKEN=replace_with_private_bot_token
JAZZ_TELEGRAM_API_ID=12345678
JAZZ_TELEGRAM_API_HASH=replace_with_private_api_hash
JAZZ_TELEGRAM_SESSION=replace_with_private_string_session
JAZZ_TELEGRAM_HISTORY_LIMIT=150
```

Get Telegram application credentials from your own Telegram developer account, then generate your local user session with:

```powershell
pnpm --filter @jazz/web telegram:login
```

Follow the local login prompts. Telegram sends the account authorization code to the account being signed in. The resulting StringSession is private and should be stored only in your local `.env`.

Never commit:

```text
JAZZ_TELEGRAM_BOT_TOKEN
JAZZ_TELEGRAM_API_HASH
JAZZ_TELEGRAM_SESSION
```

---

## Manual development mode

Use this only when you intentionally want separate terminals. Normal use should prefer `start-jazz.ps1`.

### Terminal 1 — Ollama

```powershell
ollama serve
```

### Terminal 2 — local STT

```powershell
$env:JAZZ_STT_PORT="8798"
node ".\services\stt\server.mjs"
```

### Terminal 3 — Android bridge

```powershell
node --env-file=".\bridges\windows-adb\.env" ".\bridges\windows-adb\adb-bridge.mjs"
```

### Terminal 4 — API

```powershell
$env:PORT="8797"
$env:JAZZ_LLM_PROVIDER="ollama"
$env:JAZZ_ADB_BRIDGE_URL="http://127.0.0.1:9899"
node ".\services\api\src\server.mjs"
```

Or, for deliberate `.env` development:

```powershell
node --env-file=".\services\api\.env" ".\services\api\src\server.mjs"
```

Be aware that manual `.env` values can override runtime settings and reintroduce stale paths. This is why the managed launcher does not load that file into the normal API process.

### Terminal 5 — web

```powershell
cd apps\web
$env:JAZZ_API_PORT="8797"
$env:JAZZ_STT_PORT="8798"
pnpm exec vite --force --port 5173 --strictPort
```

---

## Troubleshooting

### `EADDRINUSE 127.0.0.1:9899`

Meaning: the ADB bridge is already running.

Check the listener:

```powershell
Get-NetTCPConnection -LocalPort 9899 -State Listen
```

For normal usage, do not launch a second bridge manually. Use `start-jazz.ps1`.

### Android appears twice in `adb devices`

Wireless ADB may show both an `IP:PORT` transport and an mDNS `_adb-tls-connect._tcp` transport. This is not automatically an error. Confirm at least one transport reports `device`.

```powershell
adb devices
```

Use the active `IP:PORT` as `JAZZ_ANDROID_PHONE_SERIAL` initially.

### Android is `offline`

```powershell
adb kill-server
adb start-server
adb devices
```

If using Wireless debugging, reconnect:

```powershell
adb connect PHONE_IP:CONNECT_PORT
```

Also confirm phone and PC are on reachable networks and Wireless debugging is enabled.

### `Invalid hook call` / `useState` is null

Do not keep manually starting multiple Vite instances. Run:

```powershell
powershell -ExecutionPolicy Bypass -File ".\repair-jazz-runtime.ps1"
```

The repair script rebuilds the pnpm dependency graph and clears stale Vite/React caches.

### `ERR_PNPM_IGNORED_BUILDS` for esbuild

The current `pnpm-workspace.yaml` explicitly approves only `esbuild` because Vite requires its native install step. Pull the current repo and reinstall:

```powershell
git pull origin main
pnpm install --force
```

### Piper DLL / `0xC0000135` problem

Run:

```powershell
powershell -ExecutionPolicy Bypass -File ".\tools\piper\setup-windows.ps1"
```

Then check:

```powershell
Invoke-RestMethod http://127.0.0.1:8797/api/tts-health | ConvertTo-Json -Depth 6
```

Jazz should use:

```text
tools\piper\runtime\piper.exe
```

not an old detached `tools\piper\piper.exe`.

### Microphone is blocked

In Chrome/Edge, allow microphone access for the Jazz page and reload.

Then check STT:

```powershell
Invoke-RestMethod http://127.0.0.1:8798/health
```

### Known script phrase gets a generic AI answer

For example, if `pay 1 rupee to mom` gets an Ollama-style chat response instead of reaching your registered script, first verify you are running the latest API/bridge:

```powershell
git pull origin main
powershell -ExecutionPolicy Bypass -File ".\start-jazz.ps1"
```

Then test directly:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8797/api/chat" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"message":"pay 1 rupee to mom"}' |
ConvertTo-Json -Depth 8
```

Also verify your private local script exists if the workflow depends on one:

```powershell
Test-Path ".\scripts\android\pay-mom.ps1"
```

### View Jazz logs

Generated logs live under:

```text
.jazz/logs/
```

Common files:

```text
api.out.log
api.err.log
stt.out.log
stt.err.log
bridge.out.log
bridge.err.log
```

Example:

```powershell
Get-Content ".\.jazz\logs\api.err.log" -Tail 50
```

---

## Security rules

Jazz is intentionally local-first and allow-list based.

Keep these rules:

- Never commit real `.env` files.
- Never commit Android bridge tokens.
- Never commit Telegram StringSessions, bot tokens, or API hashes.
- Never put banking credentials, UPI PINs, device PINs, passwords, or recovery codes in GitHub.
- Keep the Windows ADB bridge bound to `127.0.0.1`.
- Keep script execution explicit and registered; do not add arbitrary shell execution from LLM output.
- Android Accessibility Service must be enabled by the device owner.
- Android authentication/security prompts remain controlled by Android and the device owner.
- Rotate any token that has been exposed publicly.

The `.gitignore` already excludes:

```text
.env
.env.local
**/.env
**/.env.local
**/.env.*.local
```

while intentionally allowing safe templates such as:

```text
.env.example
*.env.example
```

---

## Quick fresh-install checklist

```text
[ ] Install Node, pnpm, Git, ADB, Ollama
[ ] Clone Jazz-AI-Assistant
[ ] pnpm install
[ ] ollama pull qwen3:8b
[ ] Build/install Jazz Android Companion if needed
[ ] Enable Wireless debugging / connect with adb
[ ] Confirm `adb devices` shows `device`
[ ] Copy bridges/windows-adb/.env.example -> .env
[ ] Fill ADB_PATH
[ ] Fill JAZZ_ANDROID_PHONE_SERIAL
[ ] Fill JAZZ_ANDROID_PHONE_TOKEN
[ ] Run start-jazz.ps1
[ ] Confirm API :8797
[ ] Confirm STT :8798
[ ] Confirm bridge :9899
[ ] Confirm Ollama :11434
[ ] Confirm Piper health
[ ] Open http://localhost:5173
[ ] Allow microphone
[ ] Test normal chat
[ ] Test registered Android command
```

Recommended startup after the machine is configured:

```powershell
cd C:\path\to\Jazz-AI-Assistant
powershell -ExecutionPolicy Bypass -File ".\start-jazz.ps1"
```

That is the normal Jazz entry point.
