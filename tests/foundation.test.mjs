import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry, PermissionLevel } from "../packages/tools/src/registry.mjs";
import { PermissionManager } from "../packages/tools/src/permissions.mjs";
import { ToolExecutor } from "../packages/tools/src/executor.mjs";
import { registerFoundationTools } from "../packages/tools/src/foundation-tools.mjs";

const quietLogger = { info() {}, warn() {}, error() {} };

test("foundation time tool executes without confirmation", async () => {
  const registry = registerFoundationTools(new ToolRegistry());
  const executor = new ToolExecutor({ registry, permissions: new PermissionManager(), logger: quietLogger });
  const result = await executor.execute("time.getCurrent", {});
  assert.equal(result.ok, true);
  assert.ok(result.output.iso);
});

test("high-risk tools require confirmation", async () => {
  const registry = new ToolRegistry();
  registry.register({ name: "test.high", permissionLevel: PermissionLevel.HIGH, handler: async () => ({ done: true }) });
  const executor = new ToolExecutor({ registry, permissions: new PermissionManager(), logger: quietLogger });
  const pending = await executor.execute("test.high", {});
  assert.equal(pending.status, "confirmation_required");
  const confirmed = await executor.execute("test.high", {}, { confirmed: true });
  assert.equal(confirmed.ok, true);
});

test("critical tools always require explicit confirmation", () => {
  const permissions = new PermissionManager({ trustedRules: [{ tool: "test.critical", enabled: true, scope: "home" }] });
  const decision = permissions.evaluate({ name: "test.critical", permissionLevel: PermissionLevel.CRITICAL }, { scope: "home" });
  assert.equal(decision.requiresConfirmation, true);
});
