import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { WebSocket } from "ws";
import { createJazzWhatsApp, interpretAcknowledgement, parseModeCommand } from "./index.mjs";
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


test("natural mode commands and reminder language distinguish intent from completion", () => {
  for (const text of ["Could you please turn on evil mode", "Hey Jazz, switch to evil mode 😈", "enable evil mode please"]) assert.equal(parseModeCommand(text), "evil");
  assert.equal(parseModeCommand("Could you please change to normal mode"), "normal");
  assert.equal(parseModeCommand("Don't turn on evil mode"), null);
  for (const text of ["done Jazz", "Finished Jazz", "I drunk water", "Jazz I bought that medicine for mom", "I done that medicine", "I got it for mom"]) assert.equal(interpretAcknowledgement(text), "completed", text);
  for (const text of ["Okay Jazz definitely I am gonna buy medicine", "I will do it", "not done", "got it", "I should buy medicine", "Have you finished the medicine?"]) assert.equal(interpretAcknowledgement(text), "acknowledged", text);
  assert.equal(interpretAcknowledgement("Jazz right now I am driving I will call you back"), "snoozed");
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
  let seenImage;
  let pauseReply, markPaused;
  const paused = new Promise(resolve => {markPaused = resolve;});
  let app = await createJazzWhatsApp({
    directory: path.join(temp, "app"),
    clock: () => now,
    visionReply: async (question, image) => { seenImage = {question, image}; return {assistant: "A test image answer", model: "test-vision"}; },
    assistantReply: async (text, source, context) => {
      if (text === "delayed reply") {markPaused(); await new Promise(resolve => {pauseReply = resolve;});}
      return {assistant: `Reply: ${text} (${source}); context ${Array.isArray(context)}`};
    },
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
    const noiseBefore = app.publicState().messages.length;
    assert.equal((await request("/message", {text:"[SOUND]", source:"voice",callId:"ended"})).data.ignored, true);
    assert.equal(app.publicState().messages.length, noiseBefore);
    assert.equal((await request("/notifications", {deviceId:"testphone",items:[{app:"WhatsApp",title:"Mom",text:"Hello",count:2}]})).status,200);
    const summary = await request("/message", {text:"Read my notifications"});
    assert.match(summary.data.assistant.text, /2 WhatsApp messages/);
    assert.match(summary.data.assistant.text, /Mom: Hello/);
    const attachment = await request("/image", {image: "data:image/jpeg;base64,YQ=="});
    assert.equal(attachment.status, 201);
    const imageReply = await request("/message", {text: "Tell me about that picture"});
    assert.equal(imageReply.data.assistant.text, "A test image answer");
    assert.equal(seenImage.image, "data:image/jpeg;base64,YQ==");
    await request("/message", {text: "What colour is it?"});
    assert.equal(seenImage.question, "What colour is it?");
    await request("/message", {text: "What colour is it?", replyTo: attachment.data.message.id});
    assert.equal(seenImage.question, "What colour is it?");
    const activeCameraCall = (await request("/call", {})).data.call;
    assert.equal((await request("/call", {})).data.call.id, activeCameraCall.id);
    const frame = await request("/image", {image: "data:image/jpeg;base64,Yg==", callId: activeCameraCall.id});
    await request("/message", {text: "What do you see?", source: "voice", callId: activeCameraCall.id});
    assert.equal(seenImage.image, "data:image/jpeg;base64,Yg==");
    await request("/call-action", {id: activeCameraCall.id, action: "end"});
    await request("/message-action", {id: frame.data.message.id, action: "delete"});
    await request("/message-action", {id: attachment.data.message.id, action: "delete"});
    assert.equal((await request("/message", {text: "Describe it", imageId: attachment.data.message.id})).status, 400);
    await request("/clear-chat", {});

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
    assert.equal(app.publicState().calls.filter(c => c.reminderId === reminder.id).length, 1);
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
    const natural = await make("Drink water");
    await updateReminder(natural.id, {scheduledAt: new Date(now - 1).toISOString()});
    await app.tick();
    const plain = app.publicState().messages.find(m => m.reminderId === natural.id);
    assert.equal(plain.type, "reminder-text");
    now += 31000;
    await app.tick();
    assert.ok(app.publicState().messages.some(m => m.reminderId === natural.id && m.type === "reminder"));
    await request("/message", {text: "Okay Jazz I will do it", replyTo: plain.id});
    assert.equal(listVoipReminders().find(r => r.id === natural.id).status, "acknowledged");
    const beforeFollowup = app.publicState().messages.length;
    now += 600001;
    await app.tick();
    assert.ok(app.publicState().messages.length > beforeFollowup);
    assert.equal(listVoipReminders().find(r => r.id === natural.id).status, "message_sent");
    await request("/message", {text: "Jazz right now I am driving I will call you back", replyTo: plain.id});
    assert.equal(listVoipReminders().find(r => r.id === natural.id).status, "scheduled");
    assert.equal(Date.parse(listVoipReminders().find(r => r.id === natural.id).scheduledAt), now + 600000);
    now += 600001;
    await app.tick();
    await request("/message", {text: "I drunk water", replyTo: plain.id});
    assert.equal(listVoipReminders().find(r => r.id === natural.id).status, "completed");
    const ids = app.publicState().messages.slice(-2).map(m => m.id);
    await request("/delete-messages", {ids});
    assert.ok(!app.publicState().messages.some(m => ids.includes(m.id)));
    for (const call of app.publicState().calls.filter(c => ["ringing", "active"].includes(c.status))) await request("/call-action", {id: call.id, action: "end"});
    for (const r of listVoipReminders().filter(r => !["completed", "cancelled"].includes(r.status))) await request("/reminder-action", {id: r.id, action: "cancelled"});
    const retryReminder = await make("Retry medicine");
    await updateReminder(retryReminder.id, {scheduledAt: new Date(now - 1).toISOString()});
    await app.tick();
    now += 16000; await app.tick();
    for (const minutes of [5, 5, 15]) {
      const ringing = app.publicState().calls.findLast(c => c.reminderId === retryReminder.id && c.status === "ringing");
      assert.ok(ringing);
      now += 46000; await app.tick();
      const item = listVoipReminders().find(r => r.id === retryReminder.id);
      assert.equal(Date.parse(item.nextCallAt), now + minutes * 60000);
      now += minutes * 60000 - 1; await app.tick();
      assert.ok(!app.publicState().calls.some(c => c.reminderId === retryReminder.id && c.status === "ringing"));
      now++; await app.tick();
    }
    now += 46000; await app.tick();
    const exhausted = listVoipReminders().find(r => r.id === retryReminder.id);
    assert.equal(exhausted.missedAttempts, 4);
    assert.equal(exhausted.nextCallAt, null);
    assert.equal(exhausted.retryExhausted, true);
    assert.ok(app.publicState().messages.some(m => m.reminderId === retryReminder.id && /Please answer my call or message/.test(m.text)));
    now += 900001; await app.tick();
    assert.ok(!app.publicState().calls.some(c => c.reminderId === retryReminder.id && c.status === "ringing"));
    assert.equal(listVoipReminders().find(r => r.id === retryReminder.id).status, "acknowledged");
    await request("/reminder-action", {id: retryReminder.id, action: "completed"});
    now += 900001; await app.tick();
    assert.ok(!app.publicState().calls.some(c => c.reminderId === retryReminder.id && c.status === "ringing"));
    const inFlight = request("/message", {text: "delayed reply"});
    await paused;
    await request("/clear-chat", {});
    pauseReply();
    await inFlight;
    assert.deepEqual(app.publicState().messages, [], "Clear must discard a delayed model reply");
    const r4 = await make("Restart reminder");
    await updateReminder(r4.id, {
      scheduledAt: new Date(now - 1).toISOString(),
    });
    await app.tick();
    app.close();
    const statePath = path.join(temp, "app", "state.json");
    const oldState = JSON.parse(await fs.readFile(statePath, "utf8"));
    oldState.messages.push({id: "legacy-ps", sender: "jazz", text: "P.P.S. I will be available for any other tasks you have in the future."});
    oldState.messages.push({id: "legacy-prose", sender: "jazz", text: "Useful answer. P.P.S. I will be available."});
    await fs.writeFile(statePath, JSON.stringify(oldState));
    app = await createJazzWhatsApp({
      directory: path.join(temp, "app"),
      clock: () => now,
      assistantReply: async () => ({ assistant: "Hello" }),
    });
    await app.tick();
    assert.ok(!app.publicState().messages.some(m => m.id === "legacy-ps"));
    assert.equal(app.publicState().messages.find(m => m.id === "legacy-prose").text, "Useful answer.");
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
