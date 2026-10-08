import { normalizeConversationContext } from "./conversation-context.mjs";

// Ollama receives role-separated history. Repeating it inside the system
// instruction caused small models to treat old messages as new requests.
export function prepareResponseContext(systemInstruction, incomingHistory) {
  const context = normalizeConversationContext(incomingHistory);
  const basePrompt = String(systemInstruction || "");
  return {
    ollamaPrompt: basePrompt,
    legacyPrompt: context.promptText
      ? `${basePrompt}\nRecent conversation (reference only; the latest user message has priority):\n${context.promptText}`
      : basePrompt,
    history: context.history
  };
}
