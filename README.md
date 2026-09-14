# Jazz AI Assistant

A modular, permission-first personal AI assistant platform designed for Android/Termux and web clients.

## Vision
- Voice wake phrase: **Hey Jazz**
- User-authorized voice recognition
- AI chat and tool/function calling
- Web and document retrieval adapters
- Weather adapter
- Long-term memory abstraction
- Android automation through authorized APIs/accessibility services
- PC control through an authorized local/remote command adapter
- Strong permission and audit boundaries

## Repository layout

```text
apps/
  web/                 React + Vite dashboard
  android/             Android/Termux companion (planned)
services/
  api/                 Local HTTP API on port 8787
  agent/               Agent/tool orchestration
packages/
  core/                Shared domain types and policies
  tools/               Tool contracts and safe execution
  memory/              Memory interfaces
config/                Runtime configuration examples
knowledge-base/        Local knowledge ingestion area
database/              Database schema/migrations
docs/                   Architecture and security notes
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

The web app proxies `/api` requests to the Jazz API on `http://localhost:8787`. The current API provides health, chat, tools, memory, and reminder endpoints without requiring an external AI provider yet.

## Current API endpoints

```text
GET  /health
GET  /api/tools
GET  /api/memory
POST /api/memory
GET  /api/reminders
POST /api/reminders
POST /api/chat
```

Example chat request:

```bash
curl -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hey Jazz, hello"}'
```

## Security

Jazz must never bypass Android, GitHub, browser, OS, or account security controls. Device actions require explicit user authorization and the minimum required permissions.

## Important

The GitHub repository currently contains the generated architecture/UI scaffold and the code added through this connected GitHub session. It is **not** a byte-for-byte copy of your local `C:\Users\gunak\Downloads\Jazz AI Assistant` folder unless that local project is uploaded and synchronized separately.
