# Jazz AI – intelligence, attachments and artifacts upgrade

This is an additive change to `feature/jazzwhatsapp-app`. It is developed and tested on the isolated `feature/jazz-intelligence-attachments-20261008` branch. Do not copy individual files into an older Jazz runtime: use the reviewed branch and install its workspace dependencies.

## Open-source document and coding model routing (October 2026 fix)

**Bug fixed:** A message like `Create a professional PDF report about React.js` used to match the broader "create React project" coding-agent pattern first. The chat handler now gives PDF/Word/Excel creation requests priority, so it produces a **real file** using the existing in-memory artifact generator. Ordinary requests to create/fix a React application still reach the isolated coding agent.

**Use local Ollama, no paid API:**

```powershell
ollama list
# Recommended general writing model for PCs with 8 GB RAM (install once):
ollama pull qwen3:4b
# Optional: smaller Apache-2.0 model if 4B is too slow:
ollama pull qwen3:1.7b
```

The PDF/Word writer prefers already-installed 4B or 3B-class models, then the configured normal chat model. It never downloads a model implicitly. If you only have `qwen3:0.6b`, document generation can run, but writing quality and factual reliability are limited. For best results on an 8 GB/i3 PC, try `qwen3:4b` (Apache-2.0; approximately 2.5 GB download), accepting slower generation; a larger CPU model is **not** a ChatGPT-level intelligence guarantee.

Optional PowerShell environment variables (set in the same terminal **before starting** Jazz):

```powershell
$env:JAZZ_FREE_ONLY="true"
$env:JAZZ_DOCUMENT_MODEL="qwen3:4b"
# Optional: stronger general chat and voice, but slower on CPU:
$env:JAZZ_NORMAL_MODEL="qwen3:4b"
$env:JAZZ_OLLAMA_MAX_TOKENS="900"
$env:JAZZ_DOCUMENT_MAX_TOKENS="1600"
$env:JAZZ_CODING_MODEL="auto"
```

Setting `JAZZ_NORMAL_MODEL=qwen3:4b` also changes normal Jazz conversation to the 4B model; this improves capacity but can make CPU-only voice replies noticeably slower. Omit it to preserve the previous fast voice/chat model. Restart Jazz after changing models.\n\nThe coding agent now defaults to `auto` (choose an installed local text model, prefer lightweight coders) rather than assuming an unavailable `qwen3-coder:30b`. **An explicitly configured coding model remains strict:** unset it or set `auto` if the model is unavailable. The coding agent still handles code tasks in an isolated workspace; it does not silently install dependencies, edit unrelated files, or call paid APIs.

After updating the branch and running `pnpm install --no-frozen-lockfile`, restart the API and test **Create a professional PDF report about React.js**. The reply should contain a downloadable `.pdf` file, **not** an error about the 30B coding model. Download the file while the same API server is running; these URLs expire after 20 minutes. The generated document is a local-model draft and should still be fact-checked.

## Verifying the exact server answering your chat

The original `feature/jazzwhatsapp-app` server handles `Create a professional PDF report about React.js` as a coding request because document generation is absent there. The corrected implementation **must be running** on your selected API (local port 8797 or your remote Render/Cloudflare server). Updating the repository on GitHub does **not** redeploy a running Windows or cloud Node server.

The corrected server identifies itself with `GET /api/routing/health`, `routingBuild: "20261008-document-route-guard-v3"` and sample route `type: "artifact", kind: "pdf"`. Check without modifying devices or settings:

```powershell
cd C:\Users\gunak\Downloads\Jazz-AI-Test
git fetch origin
git switch feature/jazz-intelligence-attachments-20261008
git pull --ff-only origin feature/jazz-intelligence-attachments-20261008
pnpm install --no-frozen-lockfile
powershell -ExecutionPolicy Bypass -File .\start-jazz.ps1
# In a second PowerShell window, read the live API version:
powershell -ExecutionPolicy Bypass -File .\verify-jazz-artifacts.ps1
# If your app is using another server, check that URL as well:
# .\verify-jazz-artifacts.ps1 -ApiBaseUrl "https://YOUR-JAZZ-API.example"
```

If the check fails, your current chat is reaching the wrong/older backend or the updated API has not started. Check the actual server URL in Jazz Settings, restart/redeploy that backend, and repeat the read-only check. You can also inspect `http://127.0.0.1:8797/api/routing/health` in a browser. **Do not assume a model download or GitHub commit fixes an old server process.**

The coding agent also has a hard guard: PDF/Word/Excel requests do not become coding tasks even when their subject mentions React or Android. Genuine `Create a React Todo application` continues to use the coding agent. Ollama document jobs may take longer on an i3/8 GB machine; `JAZZ_DOCUMENT_TIMEOUT_MS` defaults to 360000 ms (six minutes), independently of normal conversation timeout. This prevents premature server-side aborts but does not override a shorter timeout imposed by an external mobile client or reverse proxy.

## What is actually implemented

- Ollama receives bounded, structured chat history **once**, without duplicating it in the system prompt. Fallback to Ollama retains history, and cloud-model compatibility is kept.
- The existing Jazz paperclip now opens a file picker. Up to 3 files (4 MiB each) can be selected, removed, and sent with text. The composer and panel layout remain intact. Images get local thumbnails.
- The API analyzes supported attachments in memory with no persistent upload directory. Text, code, CSV and JSON are read as text; PDF, DOCX and XLSX use local parsers. PNG/JPEG/WebP use the **existing** Ollama vision handler rather than a text-only model.
- Messages beginning with a creation request for PDF, Word/DOCX, or Excel/XLSX trigger actual file generation. Files are returned via cryptographically random download URLs; generated buffers are retained in process memory for up to 20 minutes or until evicted (maximum 12).
- XLSX expense trackers include an actual SUM formula; default item trackers include multiplication and SUM formulas. Workbook export uses ExcelJS.
- Explicit `remember ...` requests currently save to **session memory only**. They are **not persistent after restart**.
- File links are rendered with an allowlisted Markdown-link parser in the existing message renderer.

## File types

Analysis: `.txt .md .csv .json .js .jsx .ts .tsx .html .css .pdf .docx .xlsx .png .jpg .jpeg .webp`.

Legacy `.doc` and `.xls` are **not** supported by this new pipeline because secure local parsers were not added. Please convert them to DOCX/XLSX first.

## Installation / smoke test (Windows)

From the existing Jazz folder after checking out the reviewed branch (and preserving any local changes):

```powershell
pnpm install --no-frozen-lockfile
pnpm --filter @jazz/api test
pnpm --filter @jazz/web build
powershell -ExecutionPolicy Bypass -File .\start-jazz.ps1
```

Try:
- `Hey Jazz`
- `What is React Query?`, then `How is it different from Redux Toolkit?`
- Attach a small `.txt` or `.pdf` and ask for a summary
- `Create a PDF report on React Query`
- `Generate a Word letter about a project proposal`
- `Create an Excel expense tracker`

Check `GET /api/attachments/health` on port 8797 to confirm attachment limits.

## Security and deployment

This upgrade **does not add authentication** to the pre-existing shared API. If you expose port 8797 or the Vite proxy publicly (including via Cloudflare), use a separate authenticated gateway (for example, Cloudflare Access) before allowing remote clients. An opaque artifact URL is **not** a replacement for user authentication. Uploaded material is untrusted and is never executed. Its extracted text is passed to the configured LLM, so avoid attaching secrets to an untrusted cloud provider.

Do not configure open public access and assume that MIME checks or an expiring link protect the API from abuse. Large or unusual Office files may still be expensive to parse; untrusted/public uploads need further isolation, malware scanning and quotas before production deployment.

## Remaining work (not claimed complete)

- Persistent, authenticated, per-conversation file storage and follow-up retrieval
- Safe legacy DOC/XLS parsing, scanned-PDF OCR and advanced workbook/dashboard generation
- Image **generation and editing** providers (the current implementation only supports image understanding via the existing vision provider)
- Streaming upload percentages, drag/paste preview polish, stop-generation and cancellation
- True concurrency/rate limiting, file access policies, durable downloads, and local Android/voice/recovery hardware regression testing
- Piper Windows synthesis repair and server-switch/sign-out/voice regression coverage

The automated Linux CI checks the Node syntax, API tests (including generated file signatures), React/Vite build, and selected JazzWhatsApp regression suites. Passing those checks **does not prove** that Piper, Android Companion, device recovery or Windows-specific runtime integrations work on the target PC.
