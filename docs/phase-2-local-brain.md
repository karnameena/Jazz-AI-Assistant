# Phase 2 — Local Jazz Brain

Phase 2 adds a replaceable local LLM provider and a central conversation orchestrator without removing the existing API, Android, ADB, script, web or Piper implementations.

## Default architecture

```text
Web / Voice
    |
Jazz API
    |
JazzOrchestrator
    |-- deterministic registered tool/device routing
    `-- LLMProvider -> Ollama -> local model
```

The LLM never receives arbitrary OS command execution. Existing device actions should continue through the approved device/script layers and will be migrated into the central Tool Registry incrementally.

## Zero-subscription setup

Install Ollama locally, then pull a model appropriate for the machine. Example:

```powershell
ollama pull qwen3:8b
ollama list
```

Environment:

```env
JAZZ_LLM_PROVIDER=ollama
JAZZ_LLM_BASE_URL=http://127.0.0.1:11434
JAZZ_LLM_MODEL=qwen3:8b
JAZZ_LLM_TIMEOUT_MS=120000
```

No API key is required for the Ollama provider.

## Tests

```powershell
node --test tests/local-brain.test.mjs
```

## Incremental integration

The existing `services/api/src/server.mjs` currently contains Gemini/OpenAI-compatible provider logic plus deterministic Android/script routing. Do not delete it in one step. The next Phase 2 integration commit should instantiate `JazzOrchestrator`, pass the existing local intent handler as its `toolRouter`, and retain the existing HTTP/SSE/TTS contracts so the web UI remains compatible.
