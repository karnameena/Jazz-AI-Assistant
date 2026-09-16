export class LLMProvider {
  constructor(options = {}) { this.options = options; }
  async chat() { throw new Error("LLMProvider.chat must be implemented"); }
  async health() { return { ok: false, provider: "unknown" }; }
}

function cleanAssistantText(value) {
  return String(value || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^Thinking\.\.\.[\s\S]*?(?:\.\.\.done thinking\.|done thinking\.)\s*/i, "")
    .trim();
}

export class OllamaProvider extends LLMProvider {
  constructor(options = {}) {
    super(options);
    this.baseUrl = String(options.baseUrl || process.env.JAZZ_OLLAMA_URL || process.env.JAZZ_LLM_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
    this.model = options.model || process.env.JAZZ_LLM_MODEL || "qwen3:8b";
    this.timeoutMs = Number(options.timeoutMs || process.env.JAZZ_LLM_TIMEOUT_MS || 120000);
    this.think = options.think ?? (String(process.env.JAZZ_OLLAMA_THINK || "false").toLowerCase() === "true");
  }

  async health() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      const data = response.ok ? await response.json().catch(() => ({})) : {};
      const installed = Array.isArray(data?.models) ? data.models.some(item => item?.name === this.model || item?.model === this.model) : null;
      return { ok: response.ok && installed !== false, provider: "ollama", baseUrl: this.baseUrl, model: this.model, installed };
    } catch (error) {
      return { ok: false, provider: "ollama", baseUrl: this.baseUrl, model: this.model, error: error.message };
    }
  }

  async chat({ messages, system, format } = {}) {
    const normalized = [];
    if (system) normalized.push({ role: "system", content: system });
    for (const item of Array.isArray(messages) ? messages : []) {
      if (!item?.content) continue;
      normalized.push({ role: item.role || "user", content: String(item.content) });
    }
    const body = {
      model: this.model,
      messages: normalized,
      stream: false,
      think: this.think,
      keep_alive: process.env.JAZZ_OLLAMA_KEEP_ALIVE || "10m",
      options: { temperature: Number(process.env.JAZZ_LLM_TEMPERATURE || 0.6) }
    };
    if (format) body.format = format;
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Ollama request failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    }
    const data = await response.json();
    const text = cleanAssistantText(data?.message?.content);
    if (!text) throw new Error("Ollama returned no assistant text");
    return { text, model: data.model || this.model, provider: "ollama", raw: data };
  }
}

export function createLLMProvider(options = {}) {
  const provider = String(options.provider || process.env.JAZZ_LLM_PROVIDER || "ollama").toLowerCase();
  if (provider === "ollama" || provider === "local") return new OllamaProvider(options);
  throw new Error(`Unsupported local LLM provider: ${provider}`);
}
