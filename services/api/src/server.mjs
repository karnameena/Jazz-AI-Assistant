import http from "node:http";
import { devices, getDevice, sendAndroidCommand } from "./device-bridge.mjs";

const port = Number(process.env.PORT || 8787);
const memories = [];
const reminders = [];

const tools = [
  { name: "weather", description: "Get weather from an approved provider", requiresConfirmation: false },
  { name: "android", description: "Execute an explicitly authorized Android action through the configured bridge", requiresConfirmation: true },
  { name: "pc", description: "Execute an explicitly authorized PC action", requiresConfirmation: true }
];

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.end(JSON.stringify(payload));
}

function parseJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch (error) { reject(error); }
    });
  });
}

function assistantReply(message) {
  const text = String(message).trim();
  const lower = text.toLowerCase();

  if (!text) return "Tell me what you need, Mama.";
  if (lower.includes("weather")) {
    return "Weather integration is ready for an approved provider. Connect a weather provider next and Jazz can return live conditions.";
  }
  if (lower.includes("remember") || lower.includes("memory")) {
    return "I can store a memory for this session. Tell me exactly what you want Jazz to remember.";
  }
  if (lower.includes("remind") || lower.includes("reminder")) {
    return "I can create reminders through the Jazz API. Give me the reminder text and time, for example: Remind me to call Mom at 7 PM.";
  }
  if (lower.includes("android") || lower.includes("phone") || lower.includes("tablet")) {
    return "Android phone and tablet controls are permission-gated. Jazz will require explicit authorization before sending a command to your configured bridge.";
  }
  if (lower.includes("pc") || lower.includes("computer") || lower.includes("windows")) {
    return "PC actions are permission-gated too. Jazz can route an authorized action to your Windows connector.";
  }
  if (lower.includes("hello") || lower.includes("hi") || lower.includes("hey jazz")) {
    return "Hey Mama 👋 Jazz is online and ready.";
  }
  return `Jazz received your message: ${text}`;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  try {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true, service: "jazz-api", version: "0.3.0" });
      return;
    }

    if (req.method === "GET" && req.url === "/api/tools") {
      sendJson(res, 200, { ok: true, tools });
      return;
    }

    if (req.method === "GET" && req.url === "/api/devices") {
      sendJson(res, 200, { ok: true, items: devices });
      return;
    }

    if (req.method === "GET" && req.url === "/api/memory") {
      sendJson(res, 200, { ok: true, items: memories });
      return;
    }

    if (req.method === "POST" && req.url === "/api/memory") {
      const input = await parseJson(req);
      const content = typeof input.content === "string" ? input.content.trim() : "";
      if (!content) {
        sendJson(res, 400, { ok: false, error: "content is required" });
        return;
      }
      const item = { id: crypto.randomUUID(), content, createdAt: new Date().toISOString() };
      memories.push(item);
      sendJson(res, 201, { ok: true, item });
      return;
    }

    if (req.method === "GET" && req.url === "/api/reminders") {
      sendJson(res, 200, { ok: true, items: reminders });
      return;
    }

    if (req.method === "POST" && req.url === "/api/reminders") {
      const input = await parseJson(req);
      const title = typeof input.title === "string" ? input.title.trim() : "";
      const time = typeof input.time === "string" ? input.time.trim() : "";
      if (!title || !time) {
        sendJson(res, 400, { ok: false, error: "title and time are required" });
        return;
      }
      const item = { id: crypto.randomUUID(), title, time, createdAt: new Date().toISOString() };
      reminders.push(item);
      sendJson(res, 201, { ok: true, item });
      return;
    }

    if (req.method === "POST" && req.url === "/api/device-command") {
      const input = await parseJson(req);
      const deviceId = typeof input.deviceId === "string" ? input.deviceId : "";
      const action = typeof input.action === "string" ? input.action : "";
      const approved = input.approved === true;
      if (!deviceId || !action) {
        sendJson(res, 400, { ok: false, error: "deviceId and action are required" });
        return;
      }
      const device = getDevice(deviceId);
      if (!device) {
        sendJson(res, 404, { ok: false, error: "Unknown device" });
        return;
      }
      if (!approved) {
        sendJson(res, 403, { ok: false, error: "Explicit confirmation is required", status: "confirmation_required", device });
        return;
      }
      const result = await sendAndroidCommand(deviceId, action, input.args && typeof input.args === "object" ? input.args : {});
      sendJson(res, result.ok === false ? 503 : 200, result);
      return;
    }

    if (req.method === "POST" && req.url === "/api/chat") {
      const input = await parseJson(req);
      const message = typeof input.message === "string" ? input.message : "";
      sendJson(res, 200, {
        ok: true,
        assistant: assistantReply(message),
        mode: "local-scaffold"
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid request" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Jazz API listening on :${port}`);
});
