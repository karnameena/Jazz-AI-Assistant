export const PermissionLevel = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL"
});

const LEVELS = new Set(Object.values(PermissionLevel));

function assertToolDefinition(tool) {
  if (!tool || typeof tool !== "object") throw new TypeError("Tool definition is required");
  if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/.test(tool.name || "")) {
    throw new TypeError(`Invalid tool name: ${tool?.name || "<empty>"}`);
  }
  if (!tool.description || typeof tool.description !== "string") throw new TypeError(`${tool.name} requires a description`);
  if (!LEVELS.has(tool.permissionLevel)) throw new TypeError(`${tool.name} has an invalid permission level`);
  if (typeof tool.execute !== "function") throw new TypeError(`${tool.name} requires an execute function`);
  if (!Number.isFinite(tool.timeoutMs) || tool.timeoutMs <= 0) throw new TypeError(`${tool.name} requires a positive timeoutMs`);
}

export class ToolRegistry {
  constructor({ permissionManager, audit = () => undefined } = {}) {
    this.permissionManager = permissionManager || null;
    this.audit = audit;
    this.registry = new Map();
  }

  register(definition) {
    const tool = {
      inputSchema: { type: "object", additionalProperties: false },
      outputSchema: { type: "object" },
      timeoutMs: 10_000,
      ...definition
    };
    assertToolDefinition(tool);
    if (this.registry.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.registry.set(tool.name, Object.freeze(tool));
    return this;
  }

  get(name) { return this.registry.get(name) || null; }

  list() {
    return [...this.registry.values()].map(({ execute, ...metadata }) => metadata);
  }

  async execute(name, input = {}, context = {}) {
    const tool = this.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const startedAt = Date.now();
    const audit = (status, extra = {}) => this.audit({ tool: name, status, durationMs: Date.now() - startedAt, ...extra });

    if (this.permissionManager) {
      const permission = await this.permissionManager.authorize(tool, input, context);
      if (!permission?.allowed) {
        audit("denied", { reason: permission?.reason || "permission denied" });
        return { ok: false, status: permission?.confirmationRequired ? "confirmation_required" : "denied", confirmationRequired: Boolean(permission?.confirmationRequired), message: permission?.reason || "Permission denied" };
      }
    }

    audit("started");
    try {
      const result = await Promise.race([
        Promise.resolve(tool.execute(input, context)),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Tool timed out after ${tool.timeoutMs}ms`)), tool.timeoutMs))
      ]);
      audit("succeeded");
      return result && typeof result === "object" ? { ok: result.ok !== false, ...result } : { ok: true, value: result };
    } catch (error) {
      audit("failed", { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}

export class PermissionManager {
  async authorize(tool, _input, context = {}) {
    if (tool.permissionLevel === PermissionLevel.LOW) return { allowed: true };
    if (tool.permissionLevel === PermissionLevel.MEDIUM && context.allowMedium === true) return { allowed: true };
    if ((tool.permissionLevel === PermissionLevel.HIGH || tool.permissionLevel === PermissionLevel.CRITICAL) && context.confirmed === true) return { allowed: true };
    return { allowed: false, confirmationRequired: true, reason: `${tool.name} requires confirmation` };
  }
}

export function createToolRegistry(options = {}) { return new ToolRegistry(options); }

// Compatibility metadata for older API/UI code. New execution code should use ToolRegistry.
export const tools = {
  weather: { description: "Get weather from an approved weather provider", requiresConfirmation: false },
  android: { description: "Execute an explicitly authorized Android action", requiresConfirmation: true },
  pc: { description: "Execute an explicitly authorized PC action", requiresConfirmation: true }
};

export function listTools() { return Object.entries(tools).map(([name, value]) => ({ name, ...value })); }
