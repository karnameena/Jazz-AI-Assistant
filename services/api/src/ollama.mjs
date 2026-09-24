import { spawn } from "node:child_process";
import { normalizeUtterance } from "./utterance-normalizer.mjs";

const DEFAULT_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen2.5:7b";
// Prefer smaller Qwen models for low-latency voice/chat. Users can override this
// with JAZZ_OLLAMA_MODEL when they want a larger model for harder work.
const PREFERRED_MODELS = ["qwen3:1.7b", "qwen3:0.6b", "qwen3:8b", DEFAULT_MODEL];
let autoStartAttempted = false;
let cachedModel = null;
let cachedModelsSignature = "";
let warmAttemptedFor = "";

export function ollamaConfig() {
  return {
    url: (process.env.JAZZ_OLLAMA_URL || DEFAULT_URL).replace(/\/$/, ""),
    model: process.env.JAZZ_OLLAMA_MODEL || "",
    fallbackModel: process.env.JAZZ_OLLAMA_FALLBACK_MODEL || DEFAULT_MODEL,
    autoStart: process.env.JAZZ_OLLAMA_AUTOSTART !== "false",
    bin: process.env.JAZZ_OLLAMA_BIN || "ollama",
    keepAlive: process.env.JAZZ_OLLAMA_KEEP_ALIVE || "30m",
    maxTokens: Math.max(64, Number(process.env.JAZZ_OLLAMA_MAX_TOKENS || 320)),
    contextSize: Math.max(1024, Number(process.env.JAZZ_OLLAMA_CONTEXT || 4096))
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function getOllamaStatus() {
  const config = ollamaConfig();
  try {
    const response = await fetchWithTimeout(`${config.url}/api/tags`, {}, 1800);
    if (!response.ok) return { ok: false, url: config.url, models: [], error: `HTTP ${response.status}` };
    const data = await response.json();
    const models = Array.isArray(data?.models) ? data.models.map(item => item?.name).filter(Boolean) : [];
    return { ok: true, url: config.url, models };
  } catch (error) {
    return { ok: false, url: config.url, models: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function startOllamaProcess() {
  const config = ollamaConfig();
  if (!config.autoStart || autoStartAttempted) return false;
  autoStartAttempted = true;
  try {
    const child = spawn(config.bin, ["serve"], {
      detached: true,
      windowsHide: true,
      stdio: "ignore"
    });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function findInstalledModel(installed, requested) {
  return installed.find(name => name === requested || name.startsWith(`${requested}:`)) || null;
}

function chooseModel(installed, config) {
  if (config.model) return findInstalledModel(installed, config.model);
  for (const preferred of PREFERRED_MODELS) {
    const match = findInstalledModel(installed, preferred);
    if (match) return match;
  }
  return installed[0] || null;
}

function warmModelInBackground(model) {
  const config = ollamaConfig();
  if (!model || warmAttemptedFor === model) return;
  warmAttemptedFor = model;
  // Loading the model once at startup removes the largest first-voice-command delay.
  // An empty generate request asks Ollama to load/keep the model without producing text.
  void fetchWithTimeout(`${config.url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: "", stream: false, keep_alive: config.keepAlive })
  }, 60000).catch(() => {
    warmAttemptedFor = "";
  });
}

function cacheResolvedModel(models) {
  const config = ollamaConfig();
  const signature = models.join("|");
  if (cachedModel && cachedModelsSignature === signature) return cachedModel;
  const selected = chooseModel(models, config);
  if (!selected && config.model) {
    throw new Error(`Ollama model '${config.model}' is not installed. Installed models: ${models.join(", ") || "none"}.`);
  }
  cachedModel = selected;
  cachedModelsSignature = signature;
  if (selected) warmModelInBackground(selected);
  return selected;
}

export async function ensureOllamaReady() {
  let status = await getOllamaStatus();
  if (status.ok) {
    cacheResolvedModel(status.models);
    return status;
  }
  if (!startOllamaProcess()) return status;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    status = await getOllamaStatus();
    if (status.ok) {
      cacheResolvedModel(status.models);
      return status;
    }
  }
  return status;
}

async function resolveModel() {
  const config = ollamaConfig();
  // Fast path: normal chat requests no longer call /api/tags on every turn.
  if (cachedModel) return cachedModel;

  const status = await ensureOllamaReady();
  if (!status.ok) throw new Error(`Ollama is not running at ${config.url}. Install/start Ollama or run start-jazz.ps1.`);
  const selected = cacheResolvedModel(status.models);
  if (selected) return selected;
  throw new Error(`Ollama is running but has no models installed. Run: ollama pull ${config.fallbackModel}`);
}

function chatPayload(model, systemInstruction, message, stream) {
  const config = ollamaConfig();
  return {
    model,
    think: false,
    stream,
    keep_alive: config.keepAlive,
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: message }
    ],
    options: {
      temperature: Number(process.env.JAZZ_OLLAMA_TEMPERATURE || 0.35),
      num_predict: config.maxTokens,
      num_ctx: config.contextSize
    }
  };
}

function normalizeForBrain(message) {
  const understanding = normalizeUtterance(message, { source: "typed" });
  return understanding.normalized || String(message || "").trim();
}

function invalidateModelOnTransportFailure() {
  cachedModel = null;
  cachedModelsSignature = "";
  warmAttemptedFor = "";
}

export async function callOllama(message, systemInstruction) {
  const config = ollamaConfig();
  const model = await resolveModel();
  const normalizedMessage = normalizeForBrain(message);
  let response;
  try {
    response = await fetchWithTimeout(`${config.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatPayload(model, systemInstruction, normalizedMessage, false))
    }, Number(process.env.JAZZ_OLLAMA_TIMEOUT_MS || 120000));
  } catch (error) {
    invalidateModelOnTransportFailure();
    throw error;
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Ollama request failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  const data = await response.json();
  const text = typeof data?.message?.content === "string" ? data.message.content.trim() : "";
  if (!text) throw new Error("Ollama returned no text");
  return { text, model };
}

export async function streamOllama(message, systemInstruction, onText) {
  const config = ollamaConfig();
  const model = await resolveModel();
  const normalizedMessage = normalizeForBrain(message);
  let response;
  try {
    response = await fetch(`${config.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatPayload(model, systemInstruction, normalizedMessage, true))
    });
  } catch (error) {
    invalidateModelOnTransportFailure();
    throw error;
  }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Ollama stream failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let emitted = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      const chunk = typeof event?.message?.content === "string" ? event.message.content : "";
      if (chunk) {
        emitted = true;
        await onText(chunk, model);
      }
      if (event?.error) throw new Error(String(event.error));
    }
  }
  if (!emitted) throw new Error("Ollama completed without text");
  return model;
}
