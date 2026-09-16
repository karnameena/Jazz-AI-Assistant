import { JazzError, normalizeError } from "../../core/src/errors.mjs";

function withTimeout(promise, timeoutMs, name) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new JazzError("TOOL_TIMEOUT", `${name} timed out`, { retryable: true })), timeoutMs); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class ToolExecutor {
  constructor({ registry, permissions, logger }) {
    this.registry = registry;
    this.permissions = permissions;
    this.logger = logger;
  }

  async execute(name, input = {}, context = {}) {
    const tool = this.registry.get(name);
    const policy = this.permissions.evaluate(tool, context);
    this.logger?.info("tool.permission", { tool: name, policy });
    if (!policy.allowed) throw new JazzError("TOOL_DENIED", policy.reason);
    if (policy.requiresConfirmation && context.confirmed !== true) {
      return { ok: false, status: "confirmation_required", tool: name, permissionLevel: tool.permissionLevel, reason: policy.reason };
    }
    let attempt = 0;
    while (attempt <= tool.retryLimit) {
      try {
        this.logger?.info("tool.execute", { tool: name, attempt: attempt + 1 });
        const output = await withTimeout(Promise.resolve(tool.handler(input, context)), tool.timeoutMs, name);
        this.logger?.info("tool.success", { tool: name });
        return { ok: true, tool: name, output };
      } catch (error) {
        const normalized = normalizeError(error, "TOOL_EXECUTION_FAILED");
        this.logger?.warn("tool.failure", { tool: name, attempt: attempt + 1, error: normalized.toJSON() });
        if (!normalized.retryable || attempt >= tool.retryLimit) throw normalized;
        attempt += 1;
      }
    }
  }
}
