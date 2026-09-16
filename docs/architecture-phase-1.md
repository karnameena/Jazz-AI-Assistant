# Jazz AI Assistant — Phase 1 Foundation

Phase 1 introduces non-destructive foundations for the existing Jazz repository. Existing web, API, Piper, Android companion, and ADB bridge behavior is preserved.

## Local-first default

Jazz defaults to components that do not require a subscription or API key:

- LLM: Ollama on localhost, with a replaceable `LLMProvider` abstraction.
- TTS: Piper on the local machine.
- Tool execution: registered capabilities only; the LLM is never given arbitrary shell execution.

Open-source software can still have license terms, and local inference uses the user's own CPU/GPU, RAM, storage and electricity.

## Foundation flow

```text
Interface
   |
   v
Jazz API / future Orchestrator
   |
   +--> LLMProvider --> Ollama (local)
   |
   +--> ToolRegistry
           |
           v
     PermissionManager
           |
           v
       ToolExecutor
           |
      timeout/retry
           |
           v
    registered handler
```

## Security model

Permission levels are `LOW`, `MEDIUM`, `HIGH`, and `CRITICAL`. High-risk actions require confirmation unless a deliberately configured trusted rule matches. Critical actions always require explicit confirmation in the foundation implementation. Existing Android allowlists and OS security boundaries remain in place.

## New modules

- `packages/core/src/config.mjs` — centralized environment configuration.
- `packages/core/src/logger.mjs` — structured logger with secret redaction.
- `packages/core/src/errors.mjs` — shared error representation.
- `packages/llm/src/index.mjs` — provider contract and Ollama provider.
- `packages/tools/src/registry.mjs` — schema-driven tool registry.
- `packages/tools/src/permissions.mjs` — permission decisions.
- `packages/tools/src/executor.mjs` — guarded execution, timeout and bounded retry.
- `packages/tools/src/foundation-tools.mjs` — first local tool (`time.getCurrent`).
- `tests/foundation.test.mjs` — foundation behavior tests.

## Run

```powershell
pnpm install
pnpm test:foundation
```

For the local LLM, install Ollama separately, pull a model that fits the machine, and keep `JAZZ_LLM_MODEL` aligned with that installed model. The example default is `qwen3:8b`; it is configuration, not a mandatory dependency.

## Migration rule

Phase 1 intentionally does not replace `services/api/src/server.mjs`. Phase 2 will progressively route chat/reasoning through the provider/orchestrator abstractions while keeping existing endpoints compatible.
