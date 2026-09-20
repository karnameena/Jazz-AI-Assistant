import { spawn } from "node:child_process";

const DEFAULT_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen2.5:7b";
const PREFERRED_MODELS = ["qwen3:8b", "qwen3:1.7b", "qwen3:0.6b", DEFAULT_MODEL];
let autoStartAttempted = false;

export function ollamaConfig() {
  return {
    url: (process.env.JAZZ_OLLAMA_URL || DEFAULT_URL).replace(/\/$/, ""),
    model: process.env.JAZZ_OLLAMA_MODEL || "",
    fallbackModel: process.env.JAZZ_OLLAMA_FALLBACK_MODEL || DEFAULT_MODEL,
    autoStart: process.env.JAZZ_OLLAMA_AUTOSTART !== "false",
    bin: process.env.JAZZ_OLLAMA_BIN || "ollama"
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

export async function ensureOllamaReady() {
  let status = await getOllamaStatus();
  if (status.ok) return status;
  if (!startOllamaProcess()) return status;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    status = await getOllamaStatus();
    if (status.ok) return status;
  }
  return status;
}

function findInstalledModel(installed, requested) {
  return installed.find(name => name === requested || name.startsWith(`${requested}:`)) || null;
}

async function resolveModel() {
  const config = ollamaConfig();
  const status = await ensureOllamaReady();
  if (!status.ok) throw new Error(`Ollama is not running at ${config.url}. Install/start Ollama or run start-jazz.ps1.`);

  if (config.model) {
    const exact = findInstalledModel(status.models, config.model);
    if (exact) return exact;
    throw new Error(`Ollama model '${config.model}' is not installed. Installed models: ${status.models.join(", ") || "none"}.`);
  }

  for (const preferred of PREFERRED_MODELS) {
    const match = findInstalledModel(status.models, preferred);
    if (match) return match;
  }

  if (status.models.length) return status.models[0];
  throw new Error(`Ollama is running but has no models installed. Run: ollama pull ${config.fallbackModel}`);
}

function chatPayload(model, systemInstruction, message, stream) {
  return {
    model,
    think: false,
    stream,
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: message }
    ],
    options: {
      temperature: Number(process.env.JAZZ_OLLAMA_TEMPERATURE || 0.45)
    }
  };
}

export async function callOllama(message, systemInstruction) {
  const config = ollamaConfig();
  const model = await resolveModel();
  const response = await fetchWithTimeout(`${config.url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(chatPayload(model, systemInstruction, message, false))
  }, Number(process.env.JAZZ_OLLAMA_TIMEOUT_MS || 120000));
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
  const response = await fetch(`${config.url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(chatPayload(model, systemInstruction, message, true))
  });
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
