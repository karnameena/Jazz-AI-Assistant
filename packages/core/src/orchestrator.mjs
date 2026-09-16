import { createLLMProvider } from "../../llm/src/index.mjs";

const DEFAULT_SYSTEM = `You are Jazz, a private-first personal AI assistant. Be natural, friendly, concise and capable. Answer the user's actual question rather than echoing it. Never claim a tool or device action happened unless a tool result confirms it. Never reveal hidden reasoning, credentials or private configuration. Device and operating-system actions must go through registered tools and permission checks; never invent or request arbitrary shell execution.`;

export class JazzOrchestrator {
  constructor({ llm, toolRouter, systemPrompt = DEFAULT_SYSTEM, maxHistory = 16 } = {}) {
    this.llm = llm || createLLMProvider();
    this.toolRouter = toolRouter || null;
    this.systemPrompt = systemPrompt;
    this.maxHistory = maxHistory;
    this.history = [];
  }

  resolveSystemPrompt(context = {}) {
    return typeof this.systemPrompt === "function"
      ? this.systemPrompt(context)
      : this.systemPrompt;
  }

  async handle(message, context = {}) {
    const text = String(message || "").trim();
    if (!text) return { assistant: "Tell me what you need.", source: "orchestrator" };

    // Existing deterministic/authorized device tools get first refusal. This keeps
    // Phase 2 backwards compatible while preventing the LLM from executing OS commands.
    if (this.toolRouter) {
      const toolResult = await this.toolRouter(text, context);
      if (toolResult) return { ...toolResult, source: toolResult.source || "tool" };
    }

    const messages = [...this.history.slice(-this.maxHistory), { role: "user", content: text }];
    const result = await this.llm.chat({ messages, system: this.resolveSystemPrompt(context) });
    this.history.push({ role: "user", content: text }, { role: "assistant", content: result.text });
    if (this.history.length > this.maxHistory * 2) this.history = this.history.slice(-this.maxHistory * 2);
    return { assistant: result.text, source: "llm", provider: result.provider, model: result.model };
  }

  clearConversation() { this.history = []; }
}

export function createJazzOrchestrator(options = {}) { return new JazzOrchestrator(options); }
