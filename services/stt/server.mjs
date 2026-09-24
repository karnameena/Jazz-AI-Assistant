import http from "node:http";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { debugUnderstanding, normalizeUtterance } from "../api/src/utterance-normalizer.mjs";

const port = Number(process.env.JAZZ_STT_PORT || 8798);
const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../..");
const toolRoot = resolve(repoRoot, "tools", "whisper");
const runtimeDir = resolve(toolRoot, "runtime");
const defaultCli = resolve(runtimeDir, "whisper-cli.exe");
const defaultModel = resolve(toolRoot, "models", "ggml-base.en-q5_1.bin");
const setupScript = resolve(toolRoot, "setup-windows.ps1");
const maxAudioBytes = Number(process.env.JAZZ_STT_MAX_AUDIO_BYTES || 12 * 1024 * 1024);
const defaultPrompt = [
  "Jazz", "Hey Jazz", "WhatsApp", "Instagram", "YouTube", "Swiggy", "Zomato", "BookMyShow",
  "open app", "search", "scroll up", "scroll down", "play", "mobile status", "unlock mobile"
].join(", ");

function currentConfig() {
  const executable = process.env.JAZZ_WHISPER_BIN || defaultCli;
  const model = process.env.JAZZ_WHISPER_MODEL || defaultModel;
  return {
    executable,
    executableFound: existsSync(executable),
    model,
    modelFound: existsSync(model),
    runtimeDir: dirname(executable),
    setupScript,
    prompt: process.env.JAZZ_WHISPER_PROMPT || defaultPrompt
  };
}

function status() {
  const config = currentConfig();
  return {
    ok: config.executableFound && config.modelFound,
    engine: "whisper.cpp",
    local: true,
    language: "en",
    accentProfile: "Indian English / Tamil-accented English command vocabulary",
    ...config,
    prompt: undefined
  };
}

function sendJson(res, code, payload) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const length = Number(req.headers["content-length"] || 0);
    if (length > maxAudioBytes) {
      reject(Object.assign(new Error("Audio request is too large."), { statusCode: 413 }));
      return;
    }

    const chunks = [];
    let bytes = 0;
    req.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > maxAudioBytes) {
        reject(Object.assign(new Error("Audio request is too large."), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const buffer = await readBody(req);
  try { return JSON.parse(buffer.toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("Invalid JSON request."), { statusCode: 400 }); }
}

function cleanTranscript(value) {
  return String(value || "")
    .replace(/\[[0-9:.]+\s*-->\s*[0-9:.]+\]/g, " ")
    .replace(/\[(?:BLANK_AUDIO|MUSIC|SILENCE|APPLAUSE|NOISE)\]/gi, " ")
    .replace(/<\|[^>]+\|>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function executeWhisper(config, args) {
  return new Promise((resolvePromise, reject) => {
    const env = {
      ...process.env,
      PATH: `${config.runtimeDir};${process.env.PATH || ""}`
    };
    execFile(
      config.executable,
      args,
      { cwd: config.runtimeDir, env, windowsHide: true, timeout: 90000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(Object.assign(new Error(String(stderr || stdout || error.message).trim()), { stdout, stderr }));
        else resolvePromise({ stdout, stderr });
      }
    );
  });
}

async function runWhisper(wavBuffer) {
  const config = currentConfig();
  if (!config.executableFound || !config.modelFound) {
    const missing = !config.executableFound ? "Whisper CLI" : "Whisper model";
    throw new Error(`${missing} is not installed. Run ${setupScript}`);
  }
  if (!Buffer.isBuffer(wavBuffer) || wavBuffer.length <= 44) {
    throw new Error("No usable WAV audio was received.");
  }

  const workDir = mkdtempSync(join(tmpdir(), "jazz-stt-"));
  const wavPath = join(workDir, "speech.wav");
  const outputPrefix = join(workDir, "transcript");
  const outputText = `${outputPrefix}.txt`;
  writeFileSync(wavPath, wavBuffer);

  const threads = String(Math.max(2, Math.min(8, Number(process.env.JAZZ_WHISPER_THREADS || 4))));
  const baseArgs = [
    "-m", config.model,
    "-f", wavPath,
    "-l", "en",
    "-t", threads,
    "-otxt",
    "-of", outputPrefix
  ];
  const promptedArgs = config.prompt ? [...baseArgs, "--prompt", config.prompt] : baseArgs;

  try {
    let output;
    try {
      output = await executeWhisper(config, promptedArgs);
    } catch (error) {
      // Older whisper.cpp builds may not support --prompt. Fall back without it
      // instead of breaking Jazz voice input.
      const detail = String(error?.message || "");
      if (config.prompt && /(?:unknown|unrecognized|invalid).*(?:--prompt|prompt)|(?:--prompt|prompt).*(?:unknown|unrecognized|invalid)/i.test(detail)) {
        output = await executeWhisper(config, baseArgs);
      } else {
        throw error;
      }
    }

    let text = "";
    if (existsSync(outputText)) text = readFileSync(outputText, "utf8");
    if (!text.trim()) text = output.stdout;
    text = cleanTranscript(text);

    if (!text) throw new Error("Jazz did not detect clear speech in that recording.");
    return text;
  } finally {
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, { service: "jazz-local-stt", ...status() });
  }

  if (req.method === "POST" && req.url === "/normalize") {
    try {
      const input = await readJson(req);
      const raw = typeof input.text === "string" ? input.text : "";
      const source = input.source === "voice" ? "voice" : "typed";
      const understanding = normalizeUtterance(raw, { source });
      debugUnderstanding(understanding);
      return sendJson(res, 200, { ok: true, ...understanding });
    } catch (error) {
      const code = Number(error?.statusCode || 400);
      return sendJson(res, code, { ok: false, error: error instanceof Error ? error.message : "Normalization failed" });
    }
  }

  if (req.method === "POST" && req.url === "/transcribe") {
    try {
      const audio = await readBody(req);
      const rawText = await runWhisper(audio);
      const understanding = normalizeUtterance(rawText, { source: "voice" });
      debugUnderstanding(understanding);
      return sendJson(res, 200, {
        ok: true,
        engine: "whisper.cpp",
        rawText,
        text: understanding.requiresClarification ? rawText : understanding.normalized,
        understanding: {
          confidence: understanding.confidence,
          confidenceLevel: understanding.confidenceLevel,
          intent: understanding.intent,
          target: understanding.target,
          requiresClarification: understanding.requiresClarification,
          suggestion: understanding.suggestion
        }
      });
    } catch (error) {
      const code = Number(error?.statusCode || 500);
      return sendJson(res, code, { ok: false, error: error instanceof Error ? error.message : "Speech transcription failed" });
    }
  }

  return sendJson(res, 404, { ok: false, error: "Not found" });
});

server.on("error", error => {
  console.error(`[Jazz STT] Server error: ${error.message}`);
});

server.listen(port, "127.0.0.1", () => {
  const state = status();
  console.log(`[Jazz STT] Local speech service listening on 127.0.0.1:${port}`);
  if (state.ok) console.log(`[Jazz STT] Whisper ready: ${state.executable}`);
  else console.warn(`[Jazz STT] Whisper is not installed completely. Run: powershell -ExecutionPolicy Bypass -File "${setupScript}"`);
});
