const bool = (value, fallback = false) => value == null ? fallback : /^(1|true|yes|on)$/i.test(String(value));
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function loadJazzConfig(env = process.env) {
  return Object.freeze({
    environment: env.NODE_ENV || "development",
    api: { host: env.JAZZ_API_HOST || "127.0.0.1", port: number(env.PORT, 8787) },
    llm: {
      provider: env.JAZZ_LLM_PROVIDER || "ollama",
      model: env.JAZZ_LLM_MODEL || "qwen3:8b",
      baseUrl: env.JAZZ_LLM_BASE_URL || "http://127.0.0.1:11434",
      apiUrl: env.JAZZ_LLM_API_URL || "",
      apiKey: env.JAZZ_LLM_API_KEY || "",
      timeoutMs: number(env.JAZZ_LLM_TIMEOUT_MS, 120000)
    },
    tts: { provider: env.JAZZ_TTS_PROVIDER || "piper" },
    security: {
      requireConfirmationForHighRisk: bool(env.JAZZ_CONFIRM_HIGH_RISK, true),
      auditEnabled: bool(env.JAZZ_AUDIT_ENABLED, true)
    },
    devices: { bridgeUrl: env.JAZZ_ADB_BRIDGE_URL || "http://127.0.0.1:9899" }
  });
}
