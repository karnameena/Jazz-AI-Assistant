import { sanitizeJazzReply } from "./reply-quality.mjs";
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
  const value = String(text).toLowerCase().replace(/[^a-z0-9' ]/g, " ");
  if (/\b(finished driving|done driving|stopped driving)\b/.test(value)) return "acknowledged";
  if (/\b(driving|call you back|busy driving)\b/.test(value)) return "snoozed";
  if (/\b(not|haven't|havent|didn't|didnt|not yet|will|gonna|going to|shall|need to|should|must)\b/.test(value) || /^(?:what|how|when|why|can|could|have you|did you)\b/.test(value.trim())) return "acknowledged";
  if (/\b(done|completed|finished|bought|purchased|drank|drunk|taken|i got it|got the|did it|had water)\b/.test(value)) return "completed";
  return "acknowledged";
}
export function parseModeCommand(text) {
  const value = String(text).toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(don t|do not|dont|never)\b/.test(value)) return null;
  const match = value.match(/^(?:(?:hey|hi|ok|okay) )?(?:jazz )?(?:(?:could|can|would) you )?(?:please )?(?:turn on|turn|switch to|change to|enable|activate|set)(?: the)? (evil|normal) mode(?: (?:please|jazz))?$/);
  if (match) return match[1];
  if (/^(?:jazz )?(?:turn off|disable) evil mode$/.test(value)) return "normal";
  return null;
}
const BOILERPLATE = /(?:here to understand what you mean|brain and conversation layer|own personal AI assistant and technical partner)/i;
export async function createJazzWhatsApp({
  assistantReply,
  streamReply,
  visionReply,
  resolveMode = async mode => mode,
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
  state.assistantMode ||= "normal";
  state.messages = state.messages.filter(m => !m.deleted).map(m => m.sender === "jazz" && !m.reminderId ? {...m, text: sanitizeJazzReply(m.text)} : m).filter(m => m.text || m.image);
  for (const m of state.messages) if (m.sender === "jazz") delete m.replyTo;
  const confirmations = new Map();
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
    apiVersion: "1.0.5",
    capabilities: ["clear-chat", "bulk-delete", "model-modes", "reminder-followup", "image-questions", "call-resume"],
    assistantMode: state.assistantMode,
    assistantModel: state.assistantModel || null,
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
  const cancelCalls = (reminderId, endActive = false) => {
    for (const call of state.calls)
      if (call.reminderId === reminderId && (call.status === "ringing" || endActive && call.status === "active")) {
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
            nextCallAt: null,
            missedAttempts: 0,
            retryExhausted: false,
          }
        : { status: action, acknowledgedAt: new Date(clock()).toISOString(), nextTextAt: action === "acknowledged" ? new Date(clock() + 600000).toISOString() : null, nextCallAt: null, missedAttempts: 0 };
    await updateReminder(id, patch);
    cancelCalls(id, action === "snoozed");
    emit("reminder.updated", { reminder: { ...item, ...patch } });
    await save();
    return { ...item, ...patch };
  }
  async function ringReminder(reminder, dueKey) {
    let call = state.calls.find(c => c.reminderId === reminder.id && c.dueKey === dueKey);
    if (!call) {
      if (state.calls.some(c => ["ringing", "active"].includes(c.status))) return;
      call = {id: crypto.randomUUID(), direction: "incoming", status: "ringing", reminderId: reminder.id, dueKey, title: reminder.title, createdAt: new Date(clock()).toISOString()};
      state.calls.push(call);
      await save();
    }
    if (call.status !== "ringing") return;
    await updateReminder(reminder.id, {status: "calling", callStartedAt: call.createdAt, nextCallAt: null, nextTextAt: null});
    emit("call.incoming", {call});
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
            msg = message("jazz", `⏰ Mama, time for: ${reminder.title} 😊 Let me know when you have finished.`, {
              reminderId: reminder.id,
              dueKey: `${reminder.id}:${reminder.scheduledAt}`,
              type: "reminder-text",
            });
            await save();
          }
          await updateReminder(reminder.id, {
            status: "message_sent",
            messageSentAt: msg.createdAt,
            messageId: msg.id,
            actionCardAt: new Date(clock() + Math.min(30000, reminder.escalationDelaySeconds * 500)).toISOString(),
            actionCardSent: false,
          });
          emit("reminder.updated", {
            reminder: listVoipReminders().find((r) => r.id === reminder.id),
          });
        }
        if (!reminder.retryExhausted && reminder.status === "acknowledged" && reminder.nextCallAt && Date.parse(reminder.nextCallAt) <= clock()) {
          await ringReminder(reminder, `retry:${reminder.nextCallAt}`);
        }
        if (reminder.status === "acknowledged" && reminder.nextTextAt && Date.parse(reminder.nextTextAt) <= clock()) {
          const msg = message("jazz", `😊 Mama, checking in: have you finished ${reminder.title}?`, {reminderId: reminder.id, type: "reminder"});
          await updateReminder(reminder.id, {status: reminder.retryExhausted ? "acknowledged" : "message_sent", messageSentAt: msg.createdAt, messageId: msg.id, actionCardSent: true, nextTextAt: reminder.retryExhausted ? new Date(clock() + 900000).toISOString() : null});
          emit("reminder.updated", {reminder: listVoipReminders().find(r => r.id === reminder.id)});
          await save();
        }
        if (reminder.status === "message_sent" && !reminder.actionCardSent && reminder.actionCardAt && Date.parse(reminder.actionCardAt) <= clock()) {
          message("jazz", `✅ Finished ${reminder.title}, Mama? Tap Done, or Snooze if you need more time.`, {reminderId: reminder.id, type: "reminder"});
          await updateReminder(reminder.id, {actionCardSent: true});
          await save();
        }
        if (
          !reminder.retryExhausted && reminder.status === "message_sent" &&
          clock() - Date.parse(reminder.messageSentAt) >=
            reminder.escalationDelaySeconds * 1000
        ) {
          await ringReminder(reminder, reminder.messageSentAt);
        }
      }
      for (const call of state.calls)
        if (
          call.status === "ringing" &&
          clock() - Date.parse(call.createdAt) > 45000
        ) {
          call.status = "missed";
          if (call.reminderId) {
            const reminder = listVoipReminders().find(r => r.id === call.reminderId);
            if (reminder && !["completed", "cancelled", "scheduled"].includes(reminder.status)) {
              const attempts = (reminder.missedAttempts || 0) + 1;
              const delayMinutes = attempts <= 2 ? 5 : 15;
              await updateReminder(reminder.id, {status: "acknowledged", missedAttempts: attempts, retryExhausted: attempts >= 4, nextTextAt: attempts >= 4 ? new Date(clock() + 900000).toISOString() : null, nextCallAt: attempts >= 4 ? null : new Date(clock() + delayMinutes * 60000).toISOString()});
              if (attempts >= 4) message("jazz", "Mama, where are you? Please answer my call or message 😊 Tell me when you’ve finished, or snooze if you need more time.", {reminderId: reminder.id, type: "reminder"});
              emit("reminder.updated", {reminder: listVoipReminders().find(r => r.id === reminder.id)});
            }
          }
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
      if (route === "/version" && req.method === "GET") return reply(200, {ok: true, apiVersion: "1.0.5"});
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
        let incoming, early, replyMode, imageMessage;
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
          const replyLike = /^(?:(?:hey|ok|okay)\s+)?(?:jazz[, ]+)?(?:ok|okay|thanks|thank you)\b/i.test(text) || /\b(done|completed|finished|bought|purchased|drank|drunk|taken|got it|got the|did it|yes|snooze|not yet|will do|gonna buy|going to buy|driving|call you back|definitely)\b/i.test(text);
          const mentioned = outstanding.filter(r => {
            const words = r.title.toLowerCase().match(/[a-z]{4,}/g) || [];
            return words.some(w => new RegExp(`\\b${w}\\b`, "i").test(text));
          });
          const target = outstanding.length === 1 ? outstanding[0] : mentioned.length === 1 ? mentioned[0] : null;
          const inferred =
            replyLike && !body.replyTo && !voiceCall && target
              ? state.messages.findLast(
                  (m) => m.reminderId === target.id,
                ) || {reminderId: target.id}
              : null;
          const parent =
            state.messages.find((m) => m.id === body.replyTo) ||
            inferred ||
            (voiceCall?.reminderId &&
            replyLike
              ? state.messages.findLast(
                  (m) => m.reminderId === voiceCall.reminderId,
                ) || {reminderId: voiceCall.reminderId}
              : null);
          incoming = message("user", text, {
            replyTo: parent?.id,
            clientId: body.clientId,
          });
          await save();
          const sessionKey = req.headers.authorization;
          const pending = confirmations.get(sessionKey);
          if (/^(?:(?:hey\s+)?jazz[, ]+)?(?:(?:could|can|would)\s+you\s+)?(?:please\s+)?unlock\s+(?:my\s+)?(?:mobile|phone)(?:\s+(?:please|now))?[!. ]*$/i.test(text.trim())) {
            confirmations.set(sessionKey, {expires: clock() + 60000});
            early = {assistant: 'I found your approved unlockmobile.ps1 workflow. This sensitive action needs one final confirmation. Say “confirm” within 60 seconds when you want me to run it on Mobile.'};
          } else if (/^(?:jazz[, ]+)?confirm[!. ]*$/i.test(text.trim()) && pending) {
            confirmations.delete(sessionKey);
            early = pending.expires >= clock() ? await assistantReply("unlock my mobile", "typed") : {assistant: "The confirmation expired, Mama. Ask me to unlock your mobile again."};
          }
          const selectedMode = parseModeCommand(text);
          if (selectedMode) {
            try {
              const model = await resolveMode(selectedMode);
              state.assistantMode = selectedMode;
              state.assistantModel = model;
              await save();
              early = {assistant: selectedMode === "evil" ? "😈 Hey Mama, I am in Evil mode right now. Tell me what ethical hacking stuff you want to do." : "😊 Normal mode is on, Mama. What shall we do next?", model};
              emit("mode.updated", {assistantMode: selectedMode, assistantModel: model});
            } catch (error) {
              early = {assistant: `I couldn't switch models, Mama: ${error.message}`};
            }
          }
          // Only explicit quoted reminder replies acknowledge tasks; unrelated chat does not cancel calls.
          if (!early && parent?.reminderId && replyLike) {
            const snooze = text.match(
              /^snooze\s+(\d+)\s*(?:minutes?|mins?)?$/i,
            );
            const status = snooze ? "snoozed" : interpretAcknowledgement(text);
            await changeReminder(
              parent.reminderId,
              status,
              snooze ? Number(snooze[1]) : 10,
            );
            early = {
                assistant: status === "snoozed"
                  ? `🚗 Take your time, Mama. I’ve snoozed this reminder for ${snooze ? snooze[1] : 10} minutes. Focus on your driving if you are on the road.`
                  : status === "completed"
                    ? "✅ Perfect, Mama. Reminder completed!"
                    : "😊 Okay, Mama. I’ll check in again in 10 minutes. Tell me when you’ve finished.",
              };
          }
          if (!early && replyLike && !parent && !voiceCall && outstanding.length > 1)
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
          if (!early && replyLike && !parent && !voiceCall && outstanding.length === 0 && interpretAcknowledgement(text) === "completed") early = {assistant: "😊 Got it, Mama. There’s no pending reminder to complete."};
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
          replyMode = state.assistantMode;
          const quoted = state.messages.find(m => m.id === body.replyTo);
          const imageId = body.imageId || (quoted?.image ? quoted.id : quoted?.imageContextId);
          const voiceImageId = body.source === "voice" && state.calls.find(c => c.id === body.callId && c.status === "active")?.imageMessageId;
          imageMessage = state.messages.find(m => m.id === (imageId || voiceImageId) && m.image);
          if (body.imageId && !imageMessage) throw new Error("That image was deleted. Please attach it again.");
          if (!imageMessage && /\b(image|photo|picture|screenshot|what do you see|what is in (?:this|that))\b/i.test(text)) imageMessage = state.messages.findLast(m => m.image && !m.deleted);
          if (!imageMessage && /\b(it|this|that|these|those|what colou?r|explain further|more details)\b/i.test(text)) {
            const lastAnswer = state.messages.findLast(m => m.sender === "jazz" && m.type === "chat");
            imageMessage = state.messages.find(m => m.id === lastAnswer?.imageContextId && m.image);
          }
        });
        if (early?.duplicate) return reply(200, early);
        emit("jazz.typing", { active: true });
        let result;
        try {
          const context = state.messages.filter(m => m.id !== incoming.id && !m.deleted && !m.reminderId && m.type !== "control" && !BOILERPLATE.test(m.text) && sanitizeJazzReply(m.text) === m.text)
            .slice(-16).map(m => ({role: m.sender === "jazz" ? "assistant" : "user", content: m.text}));
          result =
            early ||
            (imageMessage
              ? visionReply ? await visionReply(text, imageMessage.image, context.filter(m => m.role === "user").slice(-4)) : {assistant: "Mama, image questions need a local vision model. Install moondream in Ollama and restart the updated Jazz API."}
              : streamReply
              ? await streamReply(
                  text,
                  body.source === "voice" ? "voice" : "typed",
                  context,
                  (chunk) =>
                    state.messages.some(m => m.id === incoming.id) && emit("message.delta", { id: incoming.id, text: chunk }),
                  replyMode,
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
          if (!state.messages.some(m => m.id === incoming.id)) return null;
          incoming.status = "read";
          emit("message.updated", { message: incoming });
          if (result.model && !imageMessage && state.assistantMode === replyMode) state.assistantModel = result.model;
          const msg = message(
            "jazz",
            sanitizeJazzReply(result.assistant) || "Mama, Jazz returned no usable reply. Please try again.",
            {model: result.model || null, type: early ? "control" : "chat", ...(imageMessage && !early ? {imageContextId: imageMessage.id} : {})},
          );
          await save();
          return msg;
        });
        return reply(200, { message: incoming, assistant: outgoing, assistantMode: state.assistantMode, assistantModel: state.assistantModel, apiVersion: "1.0.5" });
      }
      const body = req.method === "POST" ? await parseJson(req) : {};
      return await lock(async () => {
        if (route === "/image" && req.method === "POST") {
          if (
            typeof body.image !== "string" ||
            body.image.length > 1200000 ||
            !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
              body.image,
            )
          )
            throw new Error("Choose a smaller image");
          if (body.callId && getCall(body.callId).status !== "active") throw new Error("Call is no longer active");
          const msg = message(
            "user",
            String(body.text || "Shared image").slice(0, 500),
            { image: body.image },
          );
          if (body.callId) {
            const call = getCall(body.callId);
            if (call.status !== "active") throw new Error("Call is no longer active");
            call.imageMessageId = msg.id;
          }
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
          const existing = state.calls.find(c => ["ringing", "active"].includes(c.status));
          if (existing) return reply(200, {call: existing});
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
          } else {
            call.status = body.action === "decline" ? "declined" : "ended";
            if (call.reminderId) await changeReminder(call.reminderId, "acknowledged");
          }
          call.updatedAt = new Date(clock()).toISOString();
          await save();
          emit("call.updated", { call });
          return reply(200, { call });
        }
        if (route === "/clear-chat" && req.method === "POST") {
          state.messages = [];
          await save();
          emit("chat.cleared", {});
          return reply(200, { ok: true });
        }
        if (route === "/delete-messages" && req.method === "POST") {
          if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 500 || body.ids.some(id => typeof id !== "string")) throw new Error("Select 1–500 messages");
          const ids = new Set(body.ids);
          state.messages = state.messages.filter(m => !ids.has(m.id));
          for (const m of state.messages) if (ids.has(m.replyTo)) delete m.replyTo;
          await save();
          emit("messages.deleted", {ids: [...ids]});
          return reply(200, {ok: true, ids: [...ids]});
        }
        if (route === "/message-action" && req.method === "POST") {
          const msg = state.messages.find((m) => m.id === body.id);
          if (!msg) throw new Error("Message not found");
          if (body.action === "react")
            msg.reaction = String(body.emoji || "").slice(0, 12);
          else if (body.action === "read") msg.status = "read";
          else if (body.action === "delete") {
            state.messages = state.messages.filter(m => m.id !== msg.id);
            for (const item of state.messages) if (item.replyTo === msg.id) delete item.replyTo;
            await save();
            emit("message.deleted", { id: msg.id });
            return reply(200, { ok: true });
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
