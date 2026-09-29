# Jazz Pro Coding Agent

This service adds an isolated coding capability without replacing Jazz's existing assistant, Android, recovery, reminder, VoIP, STT, or chat flows.

## Safety model

- Coding requests are routed conservatively.
- Generated projects live under `.jazz/coding-workspaces/` by default.
- The model never receives unrestricted shell access.
- Filesystem tools are restricted to the approved workspace root.
- `.env`, private keys, SSH material, credentials and certificate files are blocked.
- Dependency installation requires explicit approval.
- Automatic Git push and automatic merge are disabled.

## Local model

The coding model is separate from Jazz's normal conversational model.

Environment variables:

```text
JAZZ_CODING_PROVIDER=ollama
JAZZ_CODING_MODEL=qwen3-coder:30b
JAZZ_CODING_SMALLER_MODEL=qwen2.5-coder:7b
JAZZ_CODING_OLLAMA_URL=http://127.0.0.1:11434
JAZZ_CODING_CONTEXT=32768
JAZZ_CODING_MAX_TOKENS=8192
JAZZ_CODING_MAX_REPAIR_ATTEMPTS=3
```

Qwen3-Coder is the preferred local coding model in this configuration. If the selected model is not installed or is too large for the machine, set `JAZZ_CODING_MODEL` to a smaller installed coding-focused model. Jazz reports the condition instead of silently switching to a paid API.

## First acceptance task

```text
Hey Jazz, create a React Todo application
```

Jazz creates the application in an isolated workspace and asks before dependency installation.

Then:

```text
Jazz, approve coding dependencies
```

Jazz installs dependencies only in that workspace and runs the production build.

The working Jazz project is not modified, merged, or pushed automatically.
