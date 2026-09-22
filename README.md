# Jazz AI Assistant

Jazz is a local-first personal AI assistant for Windows with voice, local AI, Android control, automation, and a React dashboard.

## Features

- React + Vite UI
- Ollama local LLM
- Microphone input + local STT
- Piper text-to-speech
- Android control through ADB
- Registered PowerShell/Bash scripts
- Optional Telegram integration

## Requirements

- Windows 10/11
- Node.js
- pnpm
- Git
- Android Platform Tools (`adb`)
- Ollama

## Install

```powershell
git clone https://github.com/karnameena/Jazz-AI-Assistant.git
cd Jazz-AI-Assistant
pnpm install
ollama pull qwen3:8b
```

## Android ADB

Enable **Wireless debugging** on Android, then:

```powershell
adb pair PHONE_IP:PAIR_PORT
adb connect PHONE_IP:CONNECT_PORT
adb devices
```

Use the working `IP:PORT` shown by `adb devices` in:

```text
bridges/windows-adb/.env
```

Example:

```dotenv
ADB_PATH=C:\path\to\platform-tools\adb.exe
JAZZ_ANDROID_PHONE_SERIAL=192.168.1.10:42069
JAZZ_ANDROID_PHONE_TOKEN=YOUR_PRIVATE_TOKEN
JAZZ_ADB_BRIDGE_PORT=9899
```

> Never commit real `.env` files, tokens, passwords, PINs, sessions, or payment credentials.

## Start Jazz

```powershell
powershell -ExecutionPolicy Bypass -File ".\start-jazz.ps1"
```

Open:

```text
http://localhost:5173
```

## Ports

```text
Web UI       5173
Jazz API     8797
Local STT    8798
ADB Bridge   9899
Ollama       11434
```

## Registered commands

Jazz checks registered commands before normal Ollama chat.

Examples:

```text
unlock mobile
open instagram
open youtube
take screenshot
```

Registered scripts live in:

```text
scripts/android/
```

## Repair

If the runtime or React/Vite dependencies break:

```powershell
powershell -ExecutionPolicy Bypass -File ".\repair-jazz-runtime.ps1"
```

## Quick checks

```powershell
adb devices
Invoke-RestMethod http://127.0.0.1:8797/health
Invoke-RestMethod http://127.0.0.1:9899/health
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

## Main folders

```text
apps/web                 Web UI
apps/android-companion   Android companion
services/api              Jazz API
bridges/windows-adb       ADB bridge
scripts/android           Automation scripts
tools/piper               TTS
tools/whisper             STT
```

---

**Jazz AI Assistant — local AI, voice, automation, and Android control in one dashboard.**
