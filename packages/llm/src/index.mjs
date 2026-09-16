export class LLMProvider {
  async chat(_request) { throw new Error("LLMProvider.chat must be implemented"); }
  async health() { return { ok: true, provider: this.constructor.name }; }
}

export class OllamaProvider extends LLMProvider {
  constructor({ baseUrl = "http://127.0.0.1:11434", model = "qwen3:8b", timeoutMs = 120000 } = {}) {
    super(); this.baseUrl = baseUrl.replace(/\/$/, ""); this.model = model; this.timeoutMs = timeoutMs;
  }

  async chat({ messages, tools = [], format } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, messages, tools, stream: false, ...(format ? { format } : {}) }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
      const data = await response.json();
      return { provider: "ollama", model: data.model || this.model, message: data.message, done: data.done === true };
    } finally { clearTimeout(timer); }
  }

  async health() {
    try { const response = await fetch(`${this.baseUrl}/api/tags`); return { ok: response.ok, provider: "ollama", model: this.model }; }
    catch (error) { return { ok: false, provider: "ollama", model: this.model, error: error.message }; }
  }
}

export function createLLMProvider(config) {
  const provider = config?.provider || "ollama";
  if (provider === "ollama" || provider === "local") return new OllamaProvider(config);
  throw new Error(`Unsupported local-first LLM provider: ${provider}`);
}
