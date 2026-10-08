import { spawn } from "node:child_process";
import { normalizeUtterance } from "./utterance-normalizer.mjs";

const DEFAULT_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen2.5:7b";
const DEFAULT_NORMAL_MODEL = "qwen3:0.6b";
const DEFAULT_EVIL_MODEL = "dolphin-phi:2.7b-v2.6-q2_K";
const MODE_PREFIX = /^\[JAZZ_MODE:(NORMAL|EVIL)\]\s*/i;
// Prefer smaller Qwen models for low-latency normal voice/chat when no explicit
// normal model is configured. Evil / Ethical Hack Lab mode uses its own model.
const PREFERRED_MODELS = ["qwen3:1.7b", "qwen3:0.6b", "qwen3:8b", DEFAULT_MODEL];
let autoStartAttempted = false;
let cachedInstalledModels = null;
const warmedModels = new Set();

export function ollamaConfig() {
  return {
    url: (process.env.JAZZ_OLLAMA_URL || DEFAULT_URL).replace(/\/$/, ""),
    model: process.env.JAZZ_OLLAMA_MODEL || "",
    normalModel: process.env.JAZZ_NORMAL_MODEL || process.env.JAZZ_OLLAMA_MODEL || DEFAULT_NORMAL_MODEL,
    evilModel: process.env.JAZZ_EVIL_MODEL || DEFAULT_EVIL_MODEL,
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
    cachedInstalledModels = models;
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

function chooseNormalModel(installed, config) {
  const requested = config.normalModel;
  const exact = requested ? findInstalledModel(installed, requested) : null;
  if (exact) return exact;
  if (process.env.JAZZ_NORMAL_MODEL || process.env.JAZZ_OLLAMA_MODEL) return null;
  for (const preferred of PREFERRED_MODELS) {
    const match = findInstalledModel(installed, preferred);
    if (match) return match;
  }
  return installed[0] || null;
}

function chooseModeModel(installed, mode, config) {
  if (mode === "evil") return findInstalledModel(installed, config.evilModel);
  return chooseNormalModel(installed, config);
}

function warmModelInBackground(model) {
  const config = ollamaConfig();
  if (!model || warmedModels.has(model)) return;
  warmedModels.add(model);
  void fetchWithTimeout(`${config.url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: "", stream: false, keep_alive: config.keepAlive })
  }, 60000).catch(() => {
    warmedModels.delete(model);
  });
}

export async function ensureOllamaReady() {
  let status = await getOllamaStatus();
  if (status.ok) {
    const config = ollamaConfig();
    const normal = chooseModeModel(status.models, "normal", config);
    if (normal) warmModelInBackground(normal);
    return status;
  }
  if (!startOllamaProcess()) return status;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    status = await getOllamaStatus();
    if (status.ok) {
      const config = ollamaConfig();
      const normal = chooseModeModel(status.models, "normal", config);
      if (normal) warmModelInBackground(normal);
      return status;
    }
  }
  return status;
}

export async function resolveModel(mode = "normal", taskOptions = {}) {
  const config = ollamaConfig();
  let installed = cachedInstalledModels;
  if (!installed) {
    const status = await ensureOllamaReady();
    if (!status.ok) throw new Error(`Ollama is not running at ${config.url}. Install/start Ollama or run start-jazz.ps1.`);
    installed = status.models;
  }

  // Task-specific selection is local-only. Respect explicit document choices,
  // otherwise prefer installed 3B-class models for longer, higher-quality drafts.
  // Normal conversation and Evil mode retain their existing model preferences.
  const explicit = mode === "normal" ? String(taskOptions.model || "").trim() : "";
  const preferred = mode === "normal" && Array.isArray(taskOptions.preferredModels)
    ? taskOptions.preferredModels : [];
  const selected = explicit
    ? findInstalledModel(installed, explicit)
    : (preferred.map(name => findInstalledModel(installed, name)).find(Boolean)
      || chooseModeModel(installed, mode, config));
  if (selected) {
    warmModelInBackground(selected);
    return selected;
  }

  if (explicit) throw new Error(`Local document model '${explicit}' is not installed. Run 'ollama pull ${explicit}' or unset JAZZ_DOCUMENT_MODEL to use an installed model.`);
  const requested = mode === "evil" ? config.evilModel : config.normalModel;
  throw new Error(`Ollama ${mode} model '${requested}' is not installed. Installed models: ${installed.join(", ") || "none"}.`);
}

function chatPayload(model, systemInstruction, message, stream, mode, history = [], requestOptions = {}) {
  const config = ollamaConfig();
  const modeInstruction = mode === "evil"
    ? "\n\nJazz mode: Ethical Hack Lab. Focus on authorized, defensive, CTF, sandbox, and owner-controlled security testing. Keep the answer practical and technically precise."
    : "\n\nJazz mode: Normal assistant.";
  return {
    model,
    think: false,
    stream,
    keep_alive: config.keepAlive,
    messages: [
      { role: "system", content: `${systemInstruction}${modeInstruction}` },
      ...history,
      { role: "user", content: message }
    ],
    options: {
      temperature: Number(process.env.JAZZ_OLLAMA_TEMPERATURE || 0.35),
      num_predict: Math.max(64, Number(requestOptions.maxTokens || config.maxTokens)),
      num_ctx: Math.max(1024, Number(requestOptions.contextSize || config.contextSize))
    }
  };
}

function extractModeAndMessage(message) {
  const raw = String(message || "").trim();
  const match = raw.match(MODE_PREFIX);
  const mode = match?.[1]?.toLowerCase() === "evil" ? "evil" : "normal";
  const clean = raw.replace(MODE_PREFIX, "").trim();
  return { mode, message: clean };
}

function normalizeForBrain(message) {
  const understanding = normalizeUtterance(message, { source: "typed" });
  return understanding.normalized || String(message || "").trim();
}

function invalidateModelOnTransportFailure() {
  cachedInstalledModels = null;
  warmedModels.clear();
}

export async function callOllama(message, systemInstruction, history = [], requestOptions = {}) {
  const config = ollamaConfig();
  const routed = extractModeAndMessage(message);
  const model = await resolveModel(routed.mode, requestOptions);
  const normalizedMessage = normalizeForBrain(routed.message);
  let response;
  try {
    response = await fetchWithTimeout(`${config.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatPayload(model, systemInstruction, normalizedMessage, false, routed.mode, history, requestOptions))
    }, Math.min(600000, Math.max(30000, Number(requestOptions.timeoutMs || process.env.JAZZ_OLLAMA_TIMEOUT_MS || 120000))));
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
  return { text, model, assistantMode: routed.mode };
}

export async function streamOllama(message, systemInstruction, onText, history = []) {
  const config = ollamaConfig();
  const routed = extractModeAndMessage(message);
  const model = await resolveModel(routed.mode);
  const normalizedMessage = normalizeForBrain(routed.message);
  let response;
  try {
    response = await fetch(`${config.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatPayload(model, systemInstruction, normalizedMessage, true, routed.mode, history))
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

export async function verifyModeModel(mode) {
  const status = await getOllamaStatus();
  if (!status.ok) throw new Error("Ollama is unavailable. Start Ollama and try again.");
  return resolveModel(mode);
}
