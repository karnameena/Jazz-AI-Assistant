# Jazz AI Assistant

A modular, permission-first personal AI assistant platform designed for Android/Termux and web clients.

## Current capabilities

- Browser voice input using Web Speech Recognition where supported
- Browser voice responses using Speech Synthesis
- Optional **Hey Jazz** wake-phrase parsing after the microphone is activated
- AI chat scaffold and tool/function contracts
- Session memory and reminders
- Android phone and Android tablet bridge routing
- Explicit confirmation before device commands
- Authenticated Termux bridge with a small allow-list of safe device actions

## Vision
- Voice wake phrase: **Hey Jazz**
- User-authorized voice recognition
- Real AI model integration
- Web and document retrieval adapters
- Weather adapter
- Long-term memory
- Android automation through authorized APIs/accessibility services
- PC control through an authorized local/remote command adapter
- Strong permission and audit boundaries

## Repository layout

```text
apps/
  web/                 React + Vite dashboard
services/
  api/                 Local HTTP API on port 8787
  agent/               Agent/tool orchestration
packages/
  core/                Shared domain types and policies
  tools/               Tool contracts and safe execution
  memory/              Memory interfaces
bridges/
  termux/              Android phone/tablet Termux bridge
config/                Runtime configuration examples
knowledge-base/        Local knowledge ingestion area
database/              Database schema/migrations
docs/                  Architecture and security notes
tests/                 Test suites
infrastructure/        Deployment/dev infrastructure
```

## Run the web dashboard

From the repository root:

```bash
pnpm install
pnpm --dir services/api dev
```

In a second terminal:

```bash
pnpm --dir apps/web dev
```

Open the Vite URL shown in the terminal, normally `http://localhost:5173`.

The web app proxies `/api` requests to the Jazz API on `http://localhost:8787`.

## Voice mode

Use Chrome or Edge for the best browser support. Click the microphone button and speak naturally. Jazz sends the recognized text to the API and speaks the response back using the browser speech engine.

The first version uses browser speech services rather than a custom wake-word engine, so **Hey Jazz** is parsed after the microphone has been activated. A future native/Android voice service can provide always-listening wake-word behavior.

## Android phone + tablet control

Each Android device can run the Termux bridge in `bridges/termux/android-bridge.mjs`. The Jazz API can be configured with separate bridge URLs/tokens:

```text
JAZZ_ANDROID_PHONE_BRIDGE_URL
JAZZ_ANDROID_PHONE_BRIDGE_TOKEN
JAZZ_ANDROID_TABLET_BRIDGE_URL
JAZZ_ANDROID_TABLET_BRIDGE_TOKEN
```

Current bridge actions are intentionally limited to:

```text
device_info
open_url
launch_app
speak
```

The dashboard requires an explicit confirmation before sending a device command. Advanced actions such as scrolling, taps, screenshots, calls, WhatsApp, and richer Android UI automation require a dedicated Android companion/accessibility service and will be added through authorized APIs rather than security bypasses.

See `bridges/termux/README.md` for setup.

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

Example chat request:

```bash
curl -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hey Jazz, hello"}'
```

## Security

Jazz must never bypass Android, GitHub, browser, OS, or account security controls. Device actions require explicit user authorization, authenticated bridge tokens, and the minimum required permissions.

## Important

The GitHub repository contains the generated architecture/UI scaffold and the code added through this connected GitHub session. It is **not** a byte-for-byte copy of your local `C:\Users\gunak\Downloads\Jazz AI Assistant` folder unless that local project is uploaded and synchronized separately.
