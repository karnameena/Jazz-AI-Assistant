import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { WebSocket } from "ws";
import { createJazzWhatsApp, interpretAcknowledgement } from "./index.mjs";
import {
  initVoipReminders,
  listVoipReminders,
  updateReminder,
} from "../voip-reminders.mjs";

test("completion does not mistake intent or negation for completed work", () => {
  assert.equal(interpretAcknowledgement("Done"), "completed");
  assert.equal(interpretAcknowledgement("yes I bought it"), "completed");
  for (const text of [
    "not done",
    "I will do it",
    "not yet",
    "no",
    "after dinner",
    "what is my next task",
  ])
    assert.equal(interpretAcknowledgement(text), "acknowledged");
});

test("authenticated chat, shared reminder delivery, escalation, acknowledgement, snooze and restart", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "jazzwhatsapp-test-"));
  const cwd = process.cwd();
  process.chdir(temp);
  let now = Date.now();
  process.env.JAZZWHATSAPP_ALLOW_SIGNUP = "true";
  await initVoipReminders({
    synthesize: () => {
      throw new Error("App reminders must not use Asterisk");
    },
  });
  let app = await createJazzWhatsApp({
    directory: path.join(temp, "app"),
    clock: () => now,
    assistantReply: async (text, source, context) => ({
      assistant: `Reply: ${text} (${source}); context ${context.includes("Mama:")}`,
    }),
  });
  const parse = async (req) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    return JSON.parse(body || "{}");
  };
  const send = (res, code, data) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer((req, res) =>
    app.handle(req, res, new URL(req.url, "http://local"), parse, send),
  );
  app.attach(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let token;
  const request = async (route, body, auth = true) => {
    const r = await fetch(base + "/api/jazzwhatsapp" + route, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    assert.equal((await request("/sync")).status, 401);
    const auth = await request(
      "/auth",
      { username: "mama", password: "test-password-123" },
      false,
    );
    assert.equal(auth.status, 200);
    token = auth.data.token;
    assert.equal(
      (
        await request(
          "/auth",
          { username: "mama", password: "wrong-password" },
          false,
        )
      ).status,
      401,
    );
    const socket = new WebSocket(
      base.replace("http", "ws") + "/api/jazzwhatsapp/socket",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const events = [];
    socket.on("message", (raw) => events.push(JSON.parse(raw)));
    await new Promise((resolve, reject) => {
      socket.on("open", resolve);
      socket.on("error", reject);
    });
    const first = await request("/message", {
      text: "Hello Jazz",
      clientId: "one",
    });
    assert.match(first.data.assistant.text, /context true/);
    const duplicate = await request("/message", {
      text: "Hello Jazz",
      clientId: "one",
    });
    assert.equal(duplicate.data.duplicate, true);
    const make = async (title, delay = 15) => {
      const r = await request("/reminders", {
        title,
        scheduledAt: new Date(Date.now() + 1000).toISOString(),
        escalationDelaySeconds: delay,
      });
      assert.equal(r.status, 201);
      return r.data.reminder;
    };
    const reminder = await make("Buy medicine");
    now += 2000;
    await app.tick();
    let shared = listVoipReminders().find((r) => r.id === reminder.id);
    assert.equal(shared.status, "message_sent");
    let messages = (await request("/sync")).data.messages;
    const due = messages.find((m) => m.reminderId === reminder.id);
    assert.ok(due);
    await app.tick();
    assert.equal(
      app.publicState().messages.filter((m) => m.reminderId === reminder.id)
        .length,
      1,
    );
    // An unrelated response must not cancel the reminder call.
    await request("/message", { text: "Explain React", clientId: "two" });
    assert.equal(
      listVoipReminders().find((r) => r.id === reminder.id).status,
      "message_sent",
    );
    now += 16000;
    await app.tick();
    const incoming = app
      .publicState()
      .calls.find((c) => c.reminderId === reminder.id);
    assert.equal(incoming.status, "ringing");
    await app.tick();
    assert.equal(app.publicState().calls.length, 1);
    const done = await request("/message", {
      text: "Done",
      replyTo: due.id,
      clientId: "three",
    });
    assert.match(done.data.assistant.text, /completed/);
    assert.equal(
      listVoipReminders().find((r) => r.id === reminder.id).status,
      "completed",
    );
    assert.equal(incoming.status, "cancelled");
    assert.equal(
      (await request("/call-action", { id: incoming.id, action: "answer" }))
        .status,
      400,
    );
    await request("/message", {
      text: "not yet",
      replyTo: due.id,
      clientId: "closed-check",
    });
    assert.equal(
      listVoipReminders().find((r) => r.id === reminder.id).status,
      "completed",
    );
    const r2 = await make("Call doctor");
    await updateReminder(r2.id, {
      scheduledAt: new Date(now - 1).toISOString(),
    });
    await app.tick();
    const due2 = app.publicState().messages.find((m) => m.reminderId === r2.id);
    await request("/message", {
      text: "snooze 10 minutes",
      replyTo: due2.id,
      clientId: "four",
    });
    shared = listVoipReminders().find((r) => r.id === r2.id);
    assert.equal(shared.status, "scheduled");
    assert.equal(Date.parse(shared.scheduledAt), now + 600000);
    assert.equal(
      (
        await request("/reminder-action", {
          id: r2.id,
          action: "snoozed",
          minutes: -1,
        })
      ).status,
      400,
    );
    const r3 = await make("Meeting");
    await updateReminder(r3.id, {
      scheduledAt: new Date(now - 1).toISOString(),
    });
    await app.tick();
    now += 16000;
    await app.tick();
    const call3 = app.publicState().calls.find((c) => c.reminderId === r3.id);
    assert.equal(
      (await request("/call-action", { id: call3.id, action: "answer" })).data
        .call.status,
      "active",
    );
    assert.equal(
      listVoipReminders().find((r) => r.id === r3.id).status,
      "acknowledged",
    );
    await request("/message", {
      text: "Done",
      source: "voice",
      callId: call3.id,
      clientId: "five",
    });
    assert.equal(
      listVoipReminders().find((r) => r.id === r3.id).status,
      "completed",
    );
    await request("/call-action", { id: call3.id, action: "end" });
    const r4 = await make("Restart reminder");
    await updateReminder(r4.id, {
      scheduledAt: new Date(now - 1).toISOString(),
    });
    await app.tick();
    app.close();
    app = await createJazzWhatsApp({
      directory: path.join(temp, "app"),
      clock: () => now,
      assistantReply: async () => ({ assistant: "Hello" }),
    });
    await app.tick();
    assert.equal(
      app.publicState().messages.filter((m) => m.reminderId === r4.id).length,
      1,
    );
    assert.ok(
      (await request("/sync")).data.messages.length > 0,
      "session and history persist across restart",
    );
    const profile = await request("/profile", {
      name: "Mama",
      about: "Available",
      avatar: "data:image/jpeg;base64,YQ==",
    });
    assert.equal(profile.status, 200);
    assert.equal(
      (await request("/image", { image: "data:text/html;base64,YQ==" })).status,
      400,
    );
    await request("/logout", {});
    assert.equal((await request("/sync")).status, 401);
    socket.close();
  } finally {
    app.close();
    await new Promise((resolve) => server.close(resolve));
    process.chdir(cwd);
    delete process.env.JAZZWHATSAPP_ALLOW_SIGNUP;
    await fs.rm(temp, { recursive: true, force: true });
  }
});
