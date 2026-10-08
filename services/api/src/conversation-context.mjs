const DEFAULT_MAX_MESSAGES = 12;
const DEFAULT_MAX_CHARS = 12000;
const MAX_MESSAGE_CHARS = 3000;

function cleanContent(value) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
}

export function normalizeConversationContext(input, options = {}) {
  const maxMessages = Math.max(2, Number(options.maxMessages || process.env.JAZZ_CONTEXT_MESSAGES || DEFAULT_MAX_MESSAGES));
  const maxChars = Math.max(1000, Number(options.maxChars || process.env.JAZZ_CONTEXT_CHARS || DEFAULT_MAX_CHARS));

  if (typeof input === "string") {
    const text = cleanContent(input).slice(0, maxChars);
    return { history: [], promptText: text };
  }

  if (!Array.isArray(input)) return { history: [], promptText: "" };

  const cleaned = input
    .map(item => {
      const role = item?.role === "assistant" || item?.sender === "jazz" ? "assistant"
        : item?.role === "user" || item?.sender === "user" ? "user"
        : null;
      const content = cleanContent(item?.content ?? item?.text);
      return role && content ? { role, content } : null;
    })
    .filter(Boolean)
    .slice(-maxMessages);

  const kept = [];
  let used = 0;
  for (let i = cleaned.length - 1; i >= 0; i -= 1) {
    const item = cleaned[i];
    const cost = item.content.length + item.role.length + 8;
    if (kept.length && used + cost > maxChars) break;
    kept.push(item);
    used += cost;
  }
  kept.reverse();

  const promptText = kept
    .map(item => `${item.role === "user" ? "User" : "Jazz"}: ${item.content}`)
    .join("\n");

  return { history: kept, promptText };
}

export function contextStatus() {
  return {
    maxMessages: Math.max(2, Number(process.env.JAZZ_CONTEXT_MESSAGES || DEFAULT_MAX_MESSAGES)),
    maxChars: Math.max(1000, Number(process.env.JAZZ_CONTEXT_CHARS || DEFAULT_MAX_CHARS)),
    perMessageChars: MAX_MESSAGE_CHARS
  };
}
