import { PermissionLevel } from "./registry.mjs";

export class PermissionManager {
  constructor({ trustedRules = [] } = {}) { this.trustedRules = trustedRules; }

  evaluate(tool, context = {}) {
    if (!tool) return { allowed: false, requiresConfirmation: false, reason: "Unknown tool" };
    if (tool.permissionLevel === PermissionLevel.CRITICAL) {
      return { allowed: true, requiresConfirmation: true, reason: "Critical action requires explicit confirmation" };
    }
    if (tool.permissionLevel === PermissionLevel.HIGH) {
      const trusted = this.trustedRules.some(rule => rule.tool === tool.name && rule.enabled === true && rule.scope === context.scope);
      return { allowed: true, requiresConfirmation: !trusted, reason: trusted ? "Trusted rule matched" : "High-risk action requires confirmation" };
    }
    return { allowed: true, requiresConfirmation: false, reason: "Policy allows action" };
  }
}
