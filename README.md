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
  web/                 Web UI
  android/             Android/Termux companion (planned)
services/
  api/                 API service
  agent/               Agent/tool orchestration
packages/
  core/                Shared domain types and policies
  tools/               Tool contracts and safe execution
  memory/              Memory interfaces
config/                Runtime configuration examples
knowledge-base/        Local knowledge ingestion area
database/              Database schema/migrations
docs/                   Architecture and security notes
tests/                  Test suites
infrastructure/        Deployment/dev infrastructure
```

## Security
Jazz must never bypass Android, GitHub, browser, OS, or account security controls. Device actions require explicit user authorization and the minimum required permissions.

## Status
Initial GitHub architecture scaffold. Existing local project files should be uploaded separately if they need to be reproduced byte-for-byte.
