import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
test("real Jazz API retains old routes and streams app chat through the same brain", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jazz-api-live-"));
  let llmCalls = 0;
  const ollama = http.createServer(async (req, res) => {
    if (req.url === "/api/tags") {
      res.end(JSON.stringify({ models: [{ name: "qwen3:0.6b" }] }));
      return;
    }
    let raw = "";
    for await (const b of req) raw += b;
    const input = JSON.parse(raw || "{}");
    if (input.messages?.some((m) => m.role === "user" && m.content)) llmCalls++;
    if (input.stream) {
      res.write(
        JSON.stringify({ message: { content: "Hello from " }, done: false }) +
          "\n",
      );
      res.end(
        JSON.stringify({ message: { content: "shared Jazz" }, done: true }) +
          "\n",
      );
    } else
      res.end(
        JSON.stringify({ message: { content: "Hello from shared Jazz" } }),
      );
  });
  await new Promise((r) => ollama.listen(0, "127.0.0.1", r));
  const free = http.createServer();
  await new Promise((r) => free.listen(0, "127.0.0.1", r));
  const port = free.address().port;
  await new Promise((r) => free.close(r));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../server.mjs", import.meta.url))],
    {
      cwd: directory,
      env: {
        ...process.env,
        PORT: String(port),
        JAZZ_OLLAMA_URL: `http://127.0.0.1:${ollama.address().port}`,
        JAZZ_OLLAMA_AUTOSTART: "false",
        JAZZWHATSAPP_ALLOW_SIGNUP: "true",
        JAZZ_REMINDER_DELIVERY: "jazzwhatsapp",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  child.stdout.on("data", (b) => (logs += b));
  child.stderr.on("data", (b) => (logs += b));
  const base = `http://127.0.0.1:${port}`;
  let token = "";
  const request = async (route, body) => {
    const response = await fetch(base + route, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { code: response.status, text: await response.text() };
  };
  try {
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("API startup failed: " + logs)),
        10000,
      );
      const check = () => {
        if (logs.includes("listening on")) {
          clearTimeout(deadline);
          resolve();
        } else setTimeout(check, 20);
      };
      check();
    });
    for (const route of ["/api/chat", "/api/chat/stream"]) {
      const r = await request(route, { message: "Hey Jazz" });
      assert.equal(r.code, 200);
      assert.match(r.text, /Hey Mama/);
    }
    const legacy = await request("/api/chat/stream", {
      message: "Explain React useMemo",
    });
    assert.match(legacy.text, /shared Jazz/);
    assert.doesNotMatch(legacy.text, /conversationContext is not defined/);
    const account = await request("/api/jazzwhatsapp/auth", {
      username: "mama",
      password: "testing-password",
    });
    assert.equal(account.code, 200);
    token = JSON.parse(account.text).token;
    const reply = await request("/api/jazzwhatsapp/message", {
      text: "Explain React hooks",
      clientId: "stream-test",
    });
    assert.equal(reply.code, 200);
    assert.match(reply.text, /Hello from shared Jazz/);
    assert.doesNotMatch(reply.text, /qwen3/);
    const count = llmCalls;
    const action = await request("/api/jazzwhatsapp/message", {
      text: "Open Instagram",
      clientId: "action-test",
    });
    assert.equal(action.code, 200);
    assert.equal(
      llmCalls,
      count,
      "Android action must use existing intent path, not the model",
    );
    const reminder = await request("/api/chat", {
      message: "remind me tomorrow at 7 PM to call Mom",
    });
    assert.equal(JSON.parse(reminder.text).reminder.delivery, "jazzwhatsapp");
    assert.match(reminder.text, /message you/);
    const legacyList = JSON.parse((await request("/api/reminders")).text).items;
    const appList = JSON.parse(
      (await request("/api/jazzwhatsapp/sync")).text,
    ).reminders;
    assert.equal(
      legacyList[0].id,
      appList[0].id,
      "dashboard and app share one reminder source",
    );
  } finally {
    child.kill();
    await new Promise((r) => child.once("exit", r));
    await new Promise((r) => ollama.close(r));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
