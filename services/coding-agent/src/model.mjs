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

const PREFERRED_LOCAL_MODELS = [
  "qwen2.5-coder:3b", "qwen2.5:3b", "qwen3:4b", "llama3.2:3b",
  "qwen2.5-coder:1.5b", "qwen3:1.7b", "qwen2.5-coder:7b",
  "qwen2.5:7b", "qwen3:8b", "qwen3:0.6b"
];

function matchInstalled(models, desired) {
  return models.find(name => name === desired || name.startsWith(desired + ":")) || null;
}

// Never call a paid provider. With "auto", reuse a local model the user
// already downloaded. Explicit model choices remain strict and never silently
// switch. Exclude embedding-only models from generative chat.
export function chooseInstalledCodingModel(models, requested = "auto") {
  const usable = (Array.isArray(models) ? models : []).filter(name =>
    typeof name === "string" && !/embed|nomic|mxbai|bge-|all-minilm/i.test(name));
  if (requested && requested !== "auto") return matchInstalled(usable, requested);
  for (const candidate of PREFERRED_LOCAL_MODELS) {
    const found = matchInstalled(usable, candidate);
    if (found) return found;
  }
  return usable[0] || null;
}

export async function getCodingModelStatus() {
  const cfg = codingConfig();
  if (cfg.provider !== "ollama") return { ok: false, provider: cfg.provider, error: "Only the local Ollama coding provider is enabled in this build." };
  try {
    const data = await fetchJson(`${cfg.ollamaUrl}/api/tags`, {}, 3000);
    const models = Array.isArray(data?.models) ? data.models.map(item => item?.name).filter(Boolean) : [];
    const selected = chooseInstalledCodingModel(models, cfg.model);
    const error = selected ? null : (cfg.model !== "auto"
      ? `Coding model '${cfg.model}' is not installed. Set JAZZ_CODING_MODEL=auto to reuse an installed local model or run 'ollama pull ${cfg.smallerModelRecommendation}'.`
      : `No local generative model is installed. Run 'ollama pull ${cfg.smallerModelRecommendation}' and retry. No paid API is needed.`);
    return {
      ok: Boolean(selected),
      provider: "ollama",
      url: cfg.ollamaUrl,
      model: selected || cfg.model,
      configuredModel: cfg.model,
      installed: Boolean(selected),
      models,
      recommendation: selected ? null : cfg.smallerModelRecommendation,
      error
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
      model: status.model,
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
  return { text, model: status.model, provider: "ollama" };
}
