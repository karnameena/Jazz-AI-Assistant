import { PermissionLevel } from "./registry.mjs";

export function registerFoundationTools(registry) {
  registry.register({
    name: "time.getCurrent",
    description: "Get the current local date and time without Internet access.",
    permissionLevel: PermissionLevel.LOW,
    inputSchema: { type: "object", properties: { timeZone: { type: "string" } }, additionalProperties: false },
    outputSchema: { type: "object", required: ["iso", "formatted"] },
    handler: ({ timeZone } = {}) => {
      const now = new Date();
      return { iso: now.toISOString(), formatted: new Intl.DateTimeFormat("en-IN", { dateStyle: "full", timeStyle: "long", ...(timeZone ? { timeZone } : {}) }).format(now), timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone };
    }
  });
  return registry;
}
