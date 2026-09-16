import { createLLMProvider } from "../../llm/src/index.mjs";

const DEFAULT_SYSTEM = `You are Jazz, a private-first personal AI assistant. Be natural, friendly, concise and capable. Answer the user's actual question rather than echoing it. Never claim a tool or device action happened unless a tool result confirms it. Never reveal hidden reasoning, credentials or private configuration. Device and operating-system actions must go through registered tools and permission checks; never invent or request arbitrary shell execution.`;

export class JazzOrchestrator {
  constructor({ llm, toolRouter, toolRegistry, toolResolver, systemPrompt = DEFAULT_SYSTEM, maxHistory = 16 } = {}) {
    this.llm = llm || createLLMProvider();
    this.toolRouter = toolRouter || null; // backwards-compatible deterministic router
    this.toolRegistry = toolRegistry || null;
    this.toolResolver = toolResolver || null;
    this.systemPrompt = systemPrompt;
    this.maxHistory = Math.max(1, Number(maxHistory) || 16);
    this.history = [];
  }

  resolveSystemPrompt(context = {}) {
    return typeof this.systemPrompt === "function" ? this.systemPrompt(context) : this.systemPrompt;
  }

  rememberTurn(user, assistant) {
    this.history.push({ role: "user", content: user }, { role: "assistant", content: assistant });
    if (this.history.length > this.maxHistory * 2) this.history = this.history.slice(-this.maxHistory * 2);
  }

  async tryRegisteredTool(text, context) {
    if (!this.toolRegistry || !this.toolResolver) return null;
    const request = await this.toolResolver(text, context);
    if (!request?.name) return null;
    const result = await this.toolRegistry.execute(request.name, request.input || {}, context);
    const assistant = result?.assistant || result?.message || (result?.ok ? "Done." : "I couldn't complete that action.");
    return {
      assistant,
      source: "tool",
      tool: request.name,
      executed: result?.ok === true && result?.status !== "confirmation_required",
      confirmationRequired: Boolean(result?.confirmationRequired),
      result
    };
  }

  async handle(message, context = {}) {
    const text = String(message || "").trim();
    if (!text) return { assistant: "Tell me what you need.", source: "orchestrator" };

    // Fast deterministic tools run before the LLM. The model never receives arbitrary
    // operating-system execution privileges; all actions are registry + permission gated.
    const registered = await this.tryRegisteredTool(text, context);
    if (registered) return registered;

    // Preserve existing Jazz script/device routing while it migrates into ToolRegistry.
    if (this.toolRouter) {
      const toolResult = await this.toolRouter(text, context);
      if (toolResult) return { ...toolResult, source: toolResult.source || "tool" };
    }

    const messages = [...this.history.slice(-this.maxHistory * 2), { role: "user", content: text }];
    const result = await this.llm.chat({ messages, system: this.resolveSystemPrompt(context) });
    this.rememberTurn(text, result.text);
    return { assistant: result.text, source: "llm", provider: result.provider, model: result.model };
  }

  clearConversation() { this.history = []; }
}

export function createJazzOrchestrator(options = {}) { return new JazzOrchestrator(options); }
