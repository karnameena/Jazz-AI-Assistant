const truthy = new Set(["1", "true", "yes", "on"]);

export function isFreeOnlyMode() {
  const raw = String(process.env.JAZZ_FREE_ONLY ?? "true").trim().toLowerCase();
  return truthy.has(raw);
}

export function resolveLlmProvider(requested = process.env.JAZZ_LLM_PROVIDER || "ollama") {
  const provider = String(requested || "ollama").trim().toLowerCase() || "ollama";
  if (!isFreeOnlyMode()) return provider;
  return "ollama";
}

export function assertFreeOnlyProvider(provider) {
  if (!isFreeOnlyMode()) return;
  if (String(provider || "").toLowerCase() !== "ollama") {
    const error = new Error("Jazz free-only mode allows the local Ollama provider only.");
    error.code = "paid_provider_disabled";
    throw error;
  }
}

export function getFreeModeStatus() {
  const enabled = isFreeOnlyMode();
  return {
    enabled,
    subscriptionRequired: false,
    paidCloudLlmAllowed: !enabled,
    llm: enabled ? "ollama-local" : resolveLlmProvider(),
    webSearch: "free-multi-source",
    embeddings: "local-minilm",
    speechToText: "local-whisper",
    textToSpeech: "local-piper-or-browser-fallback",
    notes: enabled
      ? "Normal Jazz startup is locked to free/local components. Cloud LLM API keys are not required or used."
      : "Free-only mode is disabled by configuration."
  };
}
