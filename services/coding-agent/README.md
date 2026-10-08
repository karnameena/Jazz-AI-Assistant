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
JAZZ_CODING_MODEL=auto
JAZZ_CODING_SMALLER_MODEL=qwen3:4b
JAZZ_CODING_OLLAMA_URL=http://127.0.0.1:11434
JAZZ_CODING_CONTEXT=4096
JAZZ_CODING_MAX_TOKENS=1536
JAZZ_CODING_MAX_REPAIR_ATTEMPTS=3
```

By default, `auto` picks an **already-installed local** text/coding model and prioritizes lightweight models appropriate for 8 GB RAM. A suitable Apache-2.0 option is `ollama pull qwen3:4b`; 4B is not downloaded automatically. You can override `JAZZ_CODING_MODEL` with an explicit installed model name. Explicit missing models produce a clear error rather than silently switching. Neither mode uses paid APIs. PDF, Word and Excel requests are handled by the artifact generator **before** the coding agent.

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
