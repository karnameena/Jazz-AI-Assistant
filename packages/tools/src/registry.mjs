export const PermissionLevel = Object.freeze({ LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH", CRITICAL: "CRITICAL" });
const levels = new Set(Object.values(PermissionLevel));

export class ToolRegistry {
  #tools = new Map();

  register(definition) {
    if (!definition?.name || typeof definition.name !== "string") throw new TypeError("Tool name is required");
    if (this.#tools.has(definition.name)) throw new Error(`Tool already registered: ${definition.name}`);
    if (!levels.has(definition.permissionLevel)) throw new TypeError(`Invalid permission level for ${definition.name}`);
    if (typeof definition.handler !== "function") throw new TypeError(`Tool handler is required: ${definition.name}`);
    const tool = Object.freeze({
      description: "",
      inputSchema: { type: "object", additionalProperties: false },
      outputSchema: { type: "object" },
      timeoutMs: 15000,
      retryLimit: 0,
      ...definition
    });
    this.#tools.set(tool.name, tool);
    return tool;
  }

  get(name) { return this.#tools.get(name) || null; }
  has(name) { return this.#tools.has(name); }
  list() {
    return [...this.#tools.values()].map(({ handler, ...metadata }) => metadata);
  }
}
