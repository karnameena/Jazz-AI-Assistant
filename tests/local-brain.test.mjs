import test from "node:test";
import assert from "node:assert/strict";
import { JazzOrchestrator } from "../packages/core/src/orchestrator.mjs";
import { PermissionLevel, PermissionManager, ToolRegistry } from "../packages/tools/src/index.mjs";

class FakeLLM {
  async chat({ messages }) { return { text: `Jazz answer: ${messages.at(-1).content}`, provider: "fake", model: "test" }; }
}

test("normal conversation is answered by the LLM provider", async () => {
  const jazz = new JazzOrchestrator({ llm: new FakeLLM() });
  const result = await jazz.handle("where are you");
  assert.equal(result.source, "llm");
  assert.equal(result.assistant, "Jazz answer: where are you");
});

test("legacy deterministic tool routing happens before LLM conversation", async () => {
  let llmCalled = false;
  const jazz = new JazzOrchestrator({
    llm: { async chat() { llmCalled = true; return { text: "wrong" }; } },
    toolRouter: async message => message === "open instagram" ? { assistant: "Instagram opened.", executed: true } : null
  });
  const result = await jazz.handle("open instagram");
  assert.equal(result.source, "tool");
  assert.equal(result.executed, true);
  assert.equal(llmCalled, false);
});

test("ToolRegistry fast path bypasses the LLM", async () => {
  let llmCalled = false;
  const registry = new ToolRegistry({ permissionManager: new PermissionManager() });
  registry.register({ name: "time.getCurrent", description: "Get current time", permissionLevel: PermissionLevel.LOW, timeoutMs: 1000, execute: async () => ({ assistant: "It is test o'clock." }) });
  const jazz = new JazzOrchestrator({
    llm: { async chat() { llmCalled = true; return { text: "wrong" }; } },
    toolRegistry: registry,
    toolResolver: async text => /time/i.test(text) ? { name: "time.getCurrent" } : null
  });
  const result = await jazz.handle("what time is it?");
  assert.equal(result.source, "tool");
  assert.equal(result.tool, "time.getCurrent");
  assert.equal(result.assistant, "It is test o'clock.");
  assert.equal(llmCalled, false);
});

test("high-risk registered tools require confirmation", async () => {
  let executed = false;
  const registry = new ToolRegistry({ permissionManager: new PermissionManager() });
  registry.register({ name: "windows.shutdown", description: "Shut down Windows", permissionLevel: PermissionLevel.HIGH, timeoutMs: 1000, execute: async () => { executed = true; return { assistant: "Shutting down." }; } });
  const blocked = await registry.execute("windows.shutdown");
  assert.equal(blocked.confirmationRequired, true);
  assert.equal(executed, false);
  const allowed = await registry.execute("windows.shutdown", {}, { confirmed: true });
  assert.equal(allowed.ok, true);
  assert.equal(executed, true);
});

test("tool registry rejects duplicate and malformed tools", () => {
  const registry = new ToolRegistry();
  assert.throws(() => registry.register({ name: "bad", description: "bad", permissionLevel: PermissionLevel.LOW, timeoutMs: 10, execute() {} }), /Invalid tool name/);
  registry.register({ name: "test.echo", description: "echo", permissionLevel: PermissionLevel.LOW, timeoutMs: 10, execute() {} });
  assert.throws(() => registry.register({ name: "test.echo", description: "echo", permissionLevel: PermissionLevel.LOW, timeoutMs: 10, execute() {} }), /already registered/);
});

test("conversation context is retained for follow-up turns", async () => {
  const seen = [];
  const llm = { async chat({ messages }) { seen.push(messages); return { text: "ok", provider: "fake", model: "test" }; } };
  const jazz = new JazzOrchestrator({ llm });
  await jazz.handle("My project is Jazz");
  await jazz.handle("What did I just say?");
  assert.equal(seen[1].some(item => item.content === "My project is Jazz"), true);
});

test("dynamic system context is refreshed on every turn", async () => {
  const systems = [];
  let memory = "first";
  const llm = { async chat({ system }) { systems.push(system); return { text: "ok", provider: "fake", model: "test" }; } };
  const jazz = new JazzOrchestrator({ llm, systemPrompt: () => `memory:${memory}` });
  await jazz.handle("one");
  memory = "second";
  await jazz.handle("two");
  assert.deepEqual(systems, ["memory:first", "memory:second"]);
});

test("conversation history stays bounded", async () => {
  const llm = { async chat() { return { text: "ok", provider: "fake", model: "test" }; } };
  const jazz = new JazzOrchestrator({ llm, maxHistory: 2 });
  await jazz.handle("one");
  await jazz.handle("two");
  await jazz.handle("three");
  assert.equal(jazz.history.length, 4);
  assert.equal(jazz.history.at(-2).content, "three");
});
