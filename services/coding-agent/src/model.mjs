import { codingConfig } from "./config.mjs";
import { redactSensitiveText } from "./security.mjs";

async function fetchJson(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function getCodingModelStatus() {
  const cfg = codingConfig();
  if (cfg.provider !== "ollama") return { ok: false, provider: cfg.provider, error: "Only the local Ollama coding provider is enabled in this build." };
  try {
    const data = await fetchJson(`${cfg.ollamaUrl}/api/tags`, {}, 3000);
    const models = Array.isArray(data?.models) ? data.models.map(item => item?.name).filter(Boolean) : [];
    const installed = models.some(name => name === cfg.model || name.startsWith(`${cfg.model}:`));
    return {
      ok: installed,
      provider: "ollama",
      url: cfg.ollamaUrl,
      model: cfg.model,
      installed,
      models,
      recommendation: installed ? null : cfg.smallerModelRecommendation,
      error: installed ? null : `Coding model '${cfg.model}' is not installed. Install it explicitly or set JAZZ_CODING_MODEL to an installed smaller coding model. Suggested lighter fallback: '${cfg.smallerModelRecommendation}'. Jazz will not silently switch to a paid API.`
    };
  } catch (error) {
    return {
      ok: false,
      provider: "ollama",
      url: cfg.ollamaUrl,
      model: cfg.model,
      installed: false,
      models: [],
      recommendation: cfg.smallerModelRecommendation,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function askCodingModel({ system, user }) {
  const cfg = codingConfig();
  if (cfg.provider !== "ollama") throw new Error(`Unsupported coding provider '${cfg.provider}'.`);
  const status = await getCodingModelStatus();
  if (!status.ok) throw new Error(status.error || "Coding model is unavailable.");
  const data = await fetchJson(`${cfg.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      stream: false,
      think: false,
      messages: [
        { role: "system", content: redactSensitiveText(system) },
        { role: "user", content: redactSensitiveText(user) }
      ],
      options: {
        temperature: 0.15,
        num_ctx: cfg.contextSize,
        num_predict: cfg.maxTokens
      }
    })
  }, 300000);
  const text = typeof data?.message?.content === "string" ? data.message.content.trim() : "";
  if (!text) throw new Error("Coding model returned no text.");
  return { text, model: cfg.model, provider: "ollama" };
}
