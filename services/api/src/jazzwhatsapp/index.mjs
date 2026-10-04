import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { WebSocketServer } from "ws";
import { synthesizeWithPiper } from "../tts.mjs";
import {
  createVoipReminder,
  listVoipReminders,
  updateReminder,
  parseReminderCommand,
} from "../voip-reminders.mjs";
const scrypt = promisify(crypto.scrypt);
export function interpretAcknowledgement(text) {
  if (/\b(not done|haven.t|not yet|no|later|after|will|going to)\b/i.test(text))
    return "acknowledged";
  if (
    /^(done|completed|finished|yes|already done|i did it|i finished it|yes i bought it|got the medicine)[.! 👍]*$/i.test(
      text.trim(),
    )
  )
    return "completed";
  return "acknowledged";
}
export async function createJazzWhatsApp({
  assistantReply,
  streamReply,
  directory = path.resolve(".jazz/jazzwhatsapp"),
  clock = Date.now,
}) {
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, "state.json");
  let state;
  try {
    state = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    state = {
      user: null,
      sessions: [],
      messages: [],
      calls: [],
      profile: { name: "Mama", about: "Available", avatar: "" },
      jazzProfile: {
        name: "Jazz AI",
        about: "Your personal AI assistant",
        avatar: "",
      },
    };
  }
  const sockets = new Set();
  let write = Promise.resolve(),
    jobs = Promise.resolve();
  const save = () => {
    const snapshot = JSON.stringify(state);
    write = write
      .then(() => fs.writeFile(file + ".tmp", snapshot, { mode: 0o600 }))
      .then(() => fs.rename(file + ".tmp", file));
    return write;
  };
  const lock = (fn) => {
    const next = jobs.then(fn);
    jobs = next.catch(() => {});
    return next;
  };
  const emit = (type, payload) => {
    const event = JSON.stringify({ type, ...payload });
    for (const socket of sockets)
      if (socket.readyState === 1) socket.send(event);
  };
  const publicState = () => ({
    messages: state.messages,
    calls: state.calls,
    profile: state.profile,
    jazzProfile: state.jazzProfile,
    reminders: listVoipReminders().filter((r) => r.delivery === "jazzwhatsapp"),
  });
  const message = (sender, text, extra = {}) => {
    const item = {
      id: crypto.randomUUID(),
      sender,
      text,
      createdAt: new Date(clock()).toISOString(),
      status: "delivered",
      ...extra,
    };
    state.messages.push(item);
    emit("message.new", { message: item });
    return item;
  };
  const tokenValid = (token) =>
    typeof token === "string" &&
    state.sessions.some(
      (s) =>
        s.hash === crypto.createHash("sha256").update(token).digest("hex") &&
        s.expires > clock(),
    );
  const getCall = (id) => {
    const call = state.calls.find((c) => c.id === id);
    if (!call) throw new Error("Call not found");
    return call;
  };
  const cancelCalls = (reminderId) => {
    for (const call of state.calls)
      if (call.reminderId === reminderId && call.status === "ringing") {
        call.status = "cancelled";
        emit("call.ended", { call });
      }
  };
  async function changeReminder(id, action, minutes = 10) {
    const item = listVoipReminders().find(
      (r) => r.id === id && r.delivery === "jazzwhatsapp",
    );
    if (!item) throw new Error("Reminder not found");
    if (["completed", "cancelled"].includes(item.status)) {
      if (action === "snoozed")
        throw new Error("This reminder is already closed");
      return item;
    }
    if (!["completed", "acknowledged", "snoozed", "cancelled"].includes(action))
      throw new Error("Invalid reminder action");
    if (
      action === "snoozed" &&
      (!Number.isFinite(Number(minutes)) || minutes < 1 || minutes > 10080)
    )
      throw new Error("Snooze must be 1–10080 minutes");
    const patch =
      action === "snoozed"
        ? {
            status: "scheduled",
            scheduledAt: new Date(
              clock() + Number(minutes) * 60000,
            ).toISOString(),
            messageSentAt: null,
            callStartedAt: null,
          }
        : { status: action, acknowledgedAt: new Date(clock()).toISOString() };
    await updateReminder(id, patch);
    cancelCalls(id);
    emit("reminder.updated", { reminder: { ...item, ...patch } });
    await save();
    return { ...item, ...patch };
  }
  async function tick() {
    return lock(async () => {
      for (const reminder of listVoipReminders().filter(
        (r) => r.delivery === "jazzwhatsapp",
      )) {
        if (
          reminder.status === "scheduled" &&
          Date.parse(reminder.scheduledAt) <= clock()
        ) {
          // Deterministic key repairs a restart between persisting a message and its reminder state.
          let msg = state.messages.find(
            (m) => m.dueKey === `${reminder.id}:${reminder.scheduledAt}`,
          );
          if (!msg) {
            msg = message("jazz", `Mama, reminder: ${reminder.title}`, {
              reminderId: reminder.id,
              dueKey: `${reminder.id}:${reminder.scheduledAt}`,
              type: "reminder",
            });
            await save();
          }
          await updateReminder(reminder.id, {
            status: "message_sent",
            messageSentAt: msg.createdAt,
            messageId: msg.id,
          });
          emit("reminder.updated", {
            reminder: listVoipReminders().find((r) => r.id === reminder.id),
          });
        }
        if (
          reminder.status === "message_sent" &&
          clock() - Date.parse(reminder.messageSentAt) >=
            reminder.escalationDelaySeconds * 1000
        ) {
          let call = state.calls.find(
            (c) =>
              c.reminderId === reminder.id &&
              c.dueKey === reminder.messageSentAt,
          );
          if (!call) {
            call = {
              id: crypto.randomUUID(),
              direction: "incoming",
              status: "ringing",
              reminderId: reminder.id,
              dueKey: reminder.messageSentAt,
              title: reminder.title,
              createdAt: new Date(clock()).toISOString(),
            };
            state.calls.push(call);
            await save();
          }
          await updateReminder(reminder.id, {
            status: "calling",
            callStartedAt: call.createdAt,
          });
          emit("call.incoming", { call });
        }
      }
      for (const call of state.calls)
        if (
          call.status === "ringing" &&
          clock() - Date.parse(call.createdAt) > 45000
        ) {
          call.status = "missed";
          emit("call.ended", { call });
          await save();
        }
    });
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  wss.on("connection", (socket) => {
    socket.alive = true;
    sockets.add(socket);
    socket.on("pong", () => (socket.alive = true));
    socket.on("error", () => sockets.delete(socket));
    socket.on("close", () => sockets.delete(socket));
    socket.send(JSON.stringify({ type: "sync", ...publicState() }));
  });
  const heartbeat = setInterval(() => {
    for (const socket of sockets) {
      if (!tokenValid(socket.authToken)) { socket.close(1008, "Session expired"); continue; }
      if (socket.alive === false) {
        socket.terminate();
        continue;
      }
      socket.alive = false;
      socket.ping();
    }
  }, 25000);
  heartbeat.unref();
  function attach(server) {
    server.on("upgrade", (req, socket, head) => {
      if (
        new URL(req.url, "http://local").pathname !== "/api/jazzwhatsapp/socket"
      ) {
        socket.destroy();
        return;
      }
      if (!tokenValid(req.headers.authorization?.replace(/^Bearer /, ""))) {
        socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.authToken = req.headers.authorization?.replace(/^Bearer /, "");
        wss.emit("connection", ws, req);
      });
    });
  }
  const attempts = new Map();
  async function handle(req, res, url, parseJson, sendJson) {
    if (!url.pathname.startsWith("/api/jazzwhatsapp/")) return false;
    const route = url.pathname.slice("/api/jazzwhatsapp".length);
    const reply = (code, data) => {
      sendJson(res, code, data);
      return true;
    };
    parseJson = async (request) => {
      let bytes = 0;
      const chunks = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 1500000)
          throw new Error("Request exceeds the 1.5 MB app limit");
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    };
    try {
      if (route === "/auth" && req.method === "POST") {
        const ip = req.socket.remoteAddress;
        const entry = attempts.get(ip) || { count: 0, time: clock() };
        if (clock() - entry.time > 60000) {
          entry.count = 0;
          entry.time = clock();
        }
        entry.count++;
        attempts.set(ip, entry);
        if (entry.count > 10)
          return reply(429, { error: "Try again in a minute" });
        const body = await parseJson(req);
        if (
          typeof body.password !== "string" ||
          body.password.length < 8 ||
          body.password.length > 256 ||
          !/^[a-zA-Z0-9_]{3,40}$/.test(body.username || "")
        )
          return reply(400, {
            error:
              "Use a username of 3–40 letters/numbers and a password of at least 8 characters",
          });
        return await lock(async () => {
          if (!state.user) {
            // First account creation requires server-side opt-in, only for initial setup.
            if (process.env.JAZZWHATSAPP_ALLOW_SIGNUP !== "true")
              return reply(403, {
                error:
                  "Account setup is disabled. Enable JAZZWHATSAPP_ALLOW_SIGNUP=true on your server for first setup.",
              });
            const salt = crypto.randomBytes(16).toString("hex");
            state.user = {
              username: body.username,
              salt,
              hash: (await scrypt(body.password, salt, 64)).toString("hex"),
            };
          }
          const hash = await scrypt(body.password, state.user.salt, 64);
          if (
            body.username !== state.user.username ||
            !crypto.timingSafeEqual(hash, Buffer.from(state.user.hash, "hex"))
          )
            return reply(401, { error: "Incorrect username or password" });
          const token = crypto.randomBytes(32).toString("hex");
          state.sessions = state.sessions.filter((s) => s.expires > clock());
          state.sessions.push({
            hash: crypto.createHash("sha256").update(token).digest("hex"),
            expires: clock() + 30 * 86400000,
          });
          await save();
          return reply(200, { token, ...publicState() });
        });
      }
      if (!tokenValid(req.headers.authorization?.replace(/^Bearer /, "")))
        return reply(401, { error: "Sign in again" });
      if (route === "/tts" && req.method === "POST") {
        const body = await parseJson(req);
        const text = String(body.text || "").slice(0, 8000);
        const audio = await synthesizeWithPiper(text);
        res.writeHead(200, { "Content-Type": "audio/wav" });
        res.end(audio);
        return true;
      }
      if (route === "/stt" && req.method === "POST") {
        const body = await parseJson(req);
        if (typeof body.audio !== "string" || body.audio.length > 1000000)
          throw new Error("Voice segment is too large");
        const audio = Buffer.from(body.audio, "base64");
        const response = await fetch(
          `${process.env.JAZZ_STT_URL || "http://127.0.0.1:8798"}/transcribe`,
          {
            method: "POST",
            headers: { "Content-Type": "audio/wav" },
            body: audio,
            signal: AbortSignal.timeout(30000),
          },
        );
        const data = await response.json();
        return reply(response.status, data);
      }
      if (route === "/sync" && req.method === "GET")
        return reply(200, publicState());
      if (route === "/message" && req.method === "POST") {
        const body = await parseJson(req);
        const text = String(body.text || "").trim();
        if (!text || text.length > 16000)
          return reply(400, { error: "Message must be 1–16000 characters" });
        let incoming, early;
        await lock(async () => {
          if (body.clientId) {
            incoming = state.messages.find((m) => m.clientId === body.clientId);
            if (incoming) {
              early = { duplicate: true, message: incoming };
              return;
            }
          }
          const voiceCall =
            body.source === "voice"
              ? state.calls.find(
                  (c) => c.id === body.callId && c.status === "active",
                )
              : null;
          const outstanding = listVoipReminders().filter(
            (r) =>
              r.delivery === "jazzwhatsapp" &&
              ["message_sent", "calling", "acknowledged"].includes(r.status),
          );
          const replyLike =
            /^(?:done|completed|finished|yes|snooze|not done|not yet|i will do|i.ll do|after dinner)\b/i.test(
              text,
            );
          const inferred =
            replyLike && !body.replyTo && !voiceCall && outstanding.length === 1
              ? state.messages.findLast(
                  (m) => m.reminderId === outstanding[0].id,
                )
              : null;
          const parent =
            state.messages.find((m) => m.id === body.replyTo) ||
            inferred ||
            (voiceCall?.reminderId &&
            /^(?:done|completed|finished|yes|snooze)\b/i.test(text)
              ? state.messages.findLast(
                  (m) => m.reminderId === voiceCall.reminderId,
                )
              : null);
          incoming = message("user", text, {
            replyTo: parent?.id,
            clientId: body.clientId,
          });
          await save();
          // Only explicit quoted reminder replies acknowledge tasks; unrelated chat does not cancel calls.
          if (parent?.reminderId) {
            const snooze = text.match(
              /^snooze\s+(\d+)\s*(?:minutes?|mins?)?$/i,
            );
            const status = snooze ? "snoozed" : interpretAcknowledgement(text);
            await changeReminder(
              parent.reminderId,
              status,
              snooze ? Number(snooze[1]) : 10,
            );
            if (snooze || status === "completed")
              early = {
                assistant: snooze
                  ? `Snoozed for ${snooze[1]} minutes, Mama.`
                  : status === "completed"
                    ? "Perfect, Mama. Reminder completed."
                    : "Got it, Mama. I have acknowledged your reminder.",
              };
          }
          if (replyLike && !parent && !voiceCall && outstanding.length > 1)
            early = {
              assistant:
                "Which reminder do you mean, Mama? Reply to its reminder bubble so I can update the right one.",
            };
          if (
            !early &&
            /^(?:what(?:.s| is| are)|show|list|tell me).{0,50}reminders?\b/i.test(
              text,
            )
          ) {
            const items = listVoipReminders().filter(
              (r) =>
                r.delivery === "jazzwhatsapp" &&
                !["completed", "cancelled"].includes(r.status),
            );
            early = {
              assistant: items.length
                ? items
                    .map(
                      (r) =>
                        `${r.title} — ${new Date(r.scheduledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
                    )
                    .join("\n")
                : "You have no outstanding reminders, Mama.",
            };
          }
          const parsed = parseReminderCommand(text);
          if (!early && parsed) {
            const reminder = await createVoipReminder({
              ...parsed,
              delivery: "jazzwhatsapp",
              escalationDelaySeconds: body.escalationDelaySeconds,
            });
            emit("reminder.updated", { reminder });
            early = {
              assistant: `Sure, Mama. I’ll message you at ${new Date(reminder.scheduledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}: ${reminder.title}`,
            };
          }
        });
        if (early?.duplicate) return reply(200, early);
        emit("jazz.typing", { active: true });
        let result;
        try {
          const context = state.messages
            .slice(-16)
            .map((m) => `${m.sender === "jazz" ? "Jazz" : "Mama"}: ${m.text}`)
            .join("\n");
          result =
            early ||
            (streamReply
              ? await streamReply(
                  text,
                  body.source === "voice" ? "voice" : "typed",
                  context,
                  (chunk) =>
                    emit("message.delta", { id: incoming.id, text: chunk }),
                )
              : await assistantReply(
                  text,
                  body.source === "voice" ? "voice" : "typed",
                  context,
                ));
        } finally {
          emit("jazz.typing", { active: false });
        }
        const outgoing = await lock(async () => {
          incoming.status = "read";
          emit("message.updated", { message: incoming });
          const msg = message(
            "jazz",
            result.assistant || "Jazz returned no reply.",
            { replyTo: incoming.id },
          );
          await save();
          return msg;
        });
        return reply(200, { message: incoming, assistant: outgoing });
      }
      const body = req.method === "POST" ? await parseJson(req) : {};
      return await lock(async () => {
        if (route === "/image" && req.method === "POST") {
          if (
            typeof body.image !== "string" ||
            body.image.length > 700000 ||
            !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
              body.image,
            )
          )
            throw new Error("Choose a smaller image");
          const msg = message(
            "user",
            String(body.text || "Shared image").slice(0, 500),
            { image: body.image },
          );
          await save();
          return reply(201, { message: msg });
        }
        if (route === "/profile" && req.method === "POST") {
          const target = body.jazz ? state.jazzProfile : state.profile;
          target.name = String(body.name || target.name).slice(0, 80);
          target.about = String(body.about || "").slice(0, 200);
          if (body.avatar !== undefined) {
            if (
              !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
                body.avatar,
              ) &&
              body.avatar !== ""
            )
              throw new Error("Invalid profile image");
            if (body.avatar.length > 700000)
              throw new Error("Choose a smaller photo");
            target.avatar = body.avatar;
          }
          await save();
          emit("profile.updated", publicState());
          return reply(200, { profile: target });
        }
        if (route === "/reminders" && req.method === "POST") {
          const reminder = await createVoipReminder({
            ...body,
            delivery: "jazzwhatsapp",
          });
          emit("reminder.updated", { reminder });
          return reply(201, { reminder });
        }
        if (route === "/reminder-action" && req.method === "POST")
          return reply(200, {
            reminder: await changeReminder(body.id, body.action, body.minutes),
          });
        if (route === "/call" && req.method === "POST") {
          if (state.calls.some((c) => ["ringing", "active"].includes(c.status)))
            throw new Error("A call is already in progress");
          const call = {
            id: crypto.randomUUID(),
            direction: "outgoing",
            status: "active",
            createdAt: new Date(clock()).toISOString(),
          };
          state.calls.push(call);
          await save();
          return reply(201, { call });
        }
        if (route === "/call-action" && req.method === "POST") {
          const call = getCall(body.id);
          if (!["answer", "decline", "end"].includes(body.action))
            throw new Error("Invalid call action");
          if (body.action === "answer") {
            if (call.status !== "ringing")
              throw new Error("Call is no longer ringing");
            call.status = "active";
            if (call.reminderId)
              await changeReminder(call.reminderId, "acknowledged");
          } else call.status = body.action === "decline" ? "declined" : "ended";
          call.updatedAt = new Date(clock()).toISOString();
          await save();
          emit("call.updated", { call });
          return reply(200, { call });
        }
        if (route === "/message-action" && req.method === "POST") {
          const msg = state.messages.find((m) => m.id === body.id);
          if (!msg) throw new Error("Message not found");
          if (body.action === "react")
            msg.reaction = String(body.emoji || "").slice(0, 12);
          else if (body.action === "read") msg.status = "read";
          else if (body.action === "delete") {
            msg.text = "Message deleted";
            msg.deleted = true;
          } else throw new Error("Invalid message action");
          await save();
          emit("message.updated", { message: msg });
          return reply(200, { message: msg });
        }
        if (route === "/logout" && req.method === "POST") {
          const token = req.headers.authorization.replace(/^Bearer /, "");
          state.sessions = state.sessions.filter(
            (s) =>
              s.hash !==
              crypto.createHash("sha256").update(token).digest("hex"),
          );
          for (const socket of sockets) socket.close();
          await save();
          return reply(200, { ok: true });
        }
        return reply(404, { error: "Not found" });
      });
    } catch (e) {
      return reply(400, { error: e.message });
    }
  }
  return {
    handle,
    attach,
    tick,
    close: () => {
      clearInterval(heartbeat);
      for (const socket of sockets) socket.terminate();
      wss.close();
    },
    publicState,
  };
}
