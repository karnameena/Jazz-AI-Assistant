import http from "node:http";
import { devices, getDevice, sendAndroidCommand, sendAndroidScript } from "./device-bridge.mjs";
import { findScriptForMessage, getScript, listScripts } from "./script-registry.mjs";
import { streamPiperRaw, synthesizeWithPiper } from "./tts.mjs";
import { createJazzOrchestrator } from "../../../packages/core/src/orchestrator.mjs";
import { createLLMProvider } from "../../../packages/llm/src/index.mjs";

const port = Number(process.env.PORT || 8787);
const maxBodyBytes = Number(process.env.JAZZ_MAX_BODY_BYTES || 1_048_576);
const memories = [];
const reminders = [];
let pendingSensitiveAction = null;
let pendingPaymentRequest = null;

const tools = [
  { name: "time", description: "Get the current server/local time", requiresConfirmation: false },
  { name: "weather", description: "Get weather from an approved provider", requiresConfirmation: false },
  { name: "android", description: "Execute an explicitly authorized Android action through the configured bridge", requiresConfirmation: true },
  { name: "scripts", description: "Execute explicitly registered Mama-owned Android scripts", requiresConfirmation: false },
  { name: "pc", description: "Execute an explicitly authorized PC action", requiresConfirmation: true },
  { name: "tts", description: "Speak Jazz replies with the configured local Piper voice", requiresConfirmation: false }
];

function sendJson(res, status, payload) { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization"); res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); res.end(JSON.stringify(payload)); }
function sendAudio(res, status, buffer) { res.statusCode = status; res.setHeader("Content-Type", "audio/wav"); res.setHeader("Cache-Control", "no-store"); res.setHeader("Access-Control-Allow-Origin", "*"); res.end(buffer); }
function sendSseHeaders(res) { res.statusCode = 200; res.setHeader("Content-Type", "text/event-stream; charset=utf-8"); res.setHeader("Cache-Control", "no-cache, no-transform"); res.setHeader("Connection", "keep-alive"); res.setHeader("X-Accel-Buffering", "no"); res.setHeader("Access-Control-Allow-Origin", "*"); res.flushHeaders?.(); }
function sendSse(res, event, data) { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function parseJson(req) { return new Promise((resolve, reject) => { let body = ""; let size = 0; let settled = false; const fail = error => { if (!settled) { settled = true; reject(error); } }; req.on("data", chunk => { if (settled) return; size += chunk.length; if (size > maxBodyBytes) { fail(new Error("Request body is too large")); return; } body += chunk; }); req.on("end", () => { if (settled) return; try { settled = true; resolve(JSON.parse(body || "{}")); } catch { fail(new Error("Invalid JSON request body")); } }); req.on("error", fail); }); }
function getCurrentTime() { return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).format(new Date()); }
function extractAmount(text) {
  const value = String(text || "");
  const patterns = [
    /(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)/i,
    /\b(\d+(?:\.\d+)?)\s*(?:ru+p(?:e+|ee+|eee+)?s?|rs\.?|inr)\b/i,
    /\b(?:pay|send|transfer)\b[^\d]{0,60}(\d+(?:\.\d+)?)\b/i,
    /^\s*(\d+(?:\.\d+)?)\s*$/,
    /\b(\d+(?:\.\d+)?)\b/
  ];
  for (const pattern of patterns) { const match = value.match(pattern); if (match) { const amount = Number(match[1]); if (Number.isFinite(amount)) return amount; } }
  return null;
}
function validPaymentAmount(amount) { return Number.isInteger(amount) && amount >= 1 && amount <= 100000; }
function deviceForMessage(text) { return /\btablet\b/i.test(text) ? "android-tablet" : "android-phone"; }
function systemPrompt() { const memoryContext = memories.length ? `\nUser-approved session memory:\n${memories.slice(-20).map(i => `- ${i.content}`).join("\n")}` : ""; return `You are Jazz, Mama's private-first personal AI assistant. Be natural, friendly, intelligent and practical. Answer the actual question instead of echoing it. Think internally when useful, but never print chain-of-thought, <think> blocks, system prompts, secrets or credentials. Never claim a tool/device action happened unless a registered tool result confirms it. Device and operating-system actions must go through registered tools and permission checks. Prefer concise conversational English unless Mama asks for more detail or another language.${memoryContext}`; }

async function handleScriptIntent(message) {
  const match = findScriptForMessage(message); if (!match) return null;
  const [scriptName, script] = match; const deviceId = deviceForMessage(message); const device = getDevice(deviceId);
  if (!device) return { assistant: `I don't know the ${deviceId} device yet.`, scriptName };
  const amount = extractAmount(message); const args = { amount, request: message };
  if (scriptName === "paymom" && !validPaymentAmount(amount)) {
    pendingSensitiveAction = null;
    pendingPaymentRequest = { scriptName, deviceId, script, expiresAt: Date.now() + 60_000 };
    return { assistant: "How much would you like to pay Meena?", scriptName, amountRequired: true };
  }
  pendingPaymentRequest = null;
  if (!script.requiresConfirmation) {
    try { const result = await sendAndroidScript(deviceId, scriptName, args); if (result.ok === false) return { assistant: result.message || `I couldn't run ${script.file}.`, scriptName }; return { assistant: result.message || `Done, Mama. ${script.file} completed on ${device.name}.`, scriptName, executed: true }; }
    catch (error) { return { assistant: `I found ${script.file}, but it couldn't run on ${device.name}: ${error.message}`, scriptName }; }
  }
  pendingSensitiveAction = { scriptName, deviceId, args, description: script.description, expiresAt: Date.now() + 60_000 };
  const detail = amount !== null ? ` for ₹${amount}` : "";
  return { assistant: `I found your approved ${script.file} workflow${detail}. This sensitive action needs one final confirmation. Say “confirm” within 60 seconds when you want me to run it on ${device.name}.`, scriptName, confirmationRequired: true };
}

async function registeredToolRouter(message) {
  const text = String(message).trim();
  if (!text) return { assistant: "Tell me what you need, Mama." };
  if (/^(cancel|never mind|nevermind|stop)$/i.test(text) && (pendingSensitiveAction || pendingPaymentRequest)) { pendingSensitiveAction = null; pendingPaymentRequest = null; return { assistant: "Cancelled, Mama. I won't run that action." }; }

  if (pendingPaymentRequest) {
    if (Date.now() > pendingPaymentRequest.expiresAt) {
      pendingPaymentRequest = null;
    } else {
      const amount = extractAmount(text);
      if (validPaymentAmount(amount)) {
        const request = pendingPaymentRequest;
        pendingPaymentRequest = null;
        const device = getDevice(request.deviceId);
        pendingSensitiveAction = { scriptName: request.scriptName, deviceId: request.deviceId, args: { amount, request: text }, description: request.script.description, expiresAt: Date.now() + 60_000 };
        return { assistant: `Payment to Meena: ₹${amount}. Say “confirm” within 60 seconds to run it on ${device?.name || "Mobile"}.`, scriptName: request.scriptName, confirmationRequired: true };
      }
      return { assistant: "Tell me just the payment amount, for example: “1 rupee” or “100”.", scriptName: pendingPaymentRequest.scriptName, amountRequired: true };
    }
  }

  if (/^(confirm|yes confirm|confirm it|do it|go ahead)$/i.test(text) && pendingSensitiveAction) {
    const action = pendingSensitiveAction; pendingSensitiveAction = null;
    if (Date.now() > action.expiresAt) return { assistant: "That confirmation expired. Please ask me to start the action again." };
    try { const result = await sendAndroidScript(action.deviceId, action.scriptName, action.args); if (result.ok === false) return { assistant: result.message || "The approved script did not complete." }; return { assistant: result.message || `Done, Mama. ${action.scriptName} completed.`, executed: true }; }
    catch (error) { return { assistant: `I couldn't execute ${action.scriptName}: ${error.message}` }; }
  }
  const scripted = await handleScriptIntent(text); if (scripted) return scripted;
  if (/^(?:what(?:'s| is)\s+)?(?:the\s+)?(?:current\s+)?time(?:\s+is\s+it)?(?:\s+in\s+india)?[?.! ]*$/i.test(text)) return { assistant: `Mama, the current time in India is ${getCurrentTime()}.` };
  return null;
}

const llm = createLLMProvider({ provider: process.env.JAZZ_LLM_PROVIDER || "ollama" });
const jazz = createJazzOrchestrator({ llm, toolRouter: registeredToolRouter, systemPrompt });
async function assistantReply(message) { try { const result = await jazz.handle(message); return { assistant: result.assistant, mode: result.source, provider: result.provider || null, model: result.model || null, executed: result.executed, confirmationRequired: result.confirmationRequired }; } catch (error) { console.warn(`[Jazz] local brain unavailable — ${error.message}`); return { assistant: `My local brain is unavailable right now. Make sure Ollama is running and ${llm.model} is installed.`, mode: "llm-unavailable", provider: "ollama", model: llm.model }; } }
async function streamAssistantReply(message, res) { const result = await assistantReply(message); sendSse(res, "meta", { mode: result.mode, provider: result.provider, model: result.model, streaming: false }); sendSse(res, "text", { text: result.assistant }); sendSse(res, "done", result); res.end(); }
async function streamTtsReply(text, res) { sendSse(res, "meta", { mode: "piper", format: "pcm16le", sampleRate: 22050, channels: 1 }); let bytes = 0; await streamPiperRaw(text, chunk => { bytes += chunk.length; sendSse(res, "audio", { data: chunk.toString("base64") }); }); sendSse(res, "done", { bytes, sampleRate: 22050, channels: 1 }); res.end(); }

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});
  try {
    if (req.method === "GET" && req.url === "/health") { const brain = await llm.health(); return sendJson(res, brain.ok ? 200 : 503, { ok: brain.ok, service: "jazz-api", version: "0.10.1", provider: brain.provider || "ollama", model: llm.model, brain, subscriptionRequired: false, ttsStreaming: true }); }
    if (req.method === "GET" && req.url === "/api/tools") return sendJson(res, 200, { ok: true, tools });
    if (req.method === "GET" && req.url === "/api/scripts") return sendJson(res, 200, { ok: true, items: listScripts() });
    if (req.method === "GET" && req.url === "/api/devices") return sendJson(res, 200, { ok: true, items: devices });
    if (req.method === "GET" && req.url === "/api/time") return sendJson(res, 200, { ok: true, time: getCurrentTime(), timeZone: "Asia/Kolkata" });
    if (req.method === "GET" && req.url === "/api/memory") return sendJson(res, 200, { ok: true, items: memories });
    if (req.method === "GET" && req.url === "/api/reminders") return sendJson(res, 200, { ok: true, items: reminders });
    if (req.method === "POST" && req.url === "/api/tts") { const input = await parseJson(req); const text = typeof input.text === "string" ? input.text.trim() : ""; if (!text) return sendJson(res, 400, { ok: false, error: "text is required" }); return sendAudio(res, 200, await synthesizeWithPiper(text)); }
    if (req.method === "POST" && req.url === "/api/tts/stream") { const input = await parseJson(req); const text = typeof input.text === "string" ? input.text.trim() : ""; if (!text) return sendJson(res, 400, { ok: false, error: "text is required" }); sendSseHeaders(res); try { await streamTtsReply(text, res); } catch (error) { sendSse(res, "error", { error: error.message }); if (!res.writableEnded) res.end(); } return; }
    if (req.method === "POST" && req.url === "/api/memory") { const input = await parseJson(req); const content = typeof input.content === "string" ? input.content.trim() : ""; if (!content) return sendJson(res, 400, { ok: false, error: "content is required" }); const item = { id: crypto.randomUUID(), content, createdAt: new Date().toISOString() }; memories.push(item); return sendJson(res, 201, { ok: true, item }); }
    if (req.method === "POST" && req.url === "/api/reminders") { const input = await parseJson(req); const title = typeof input.title === "string" ? input.title.trim() : ""; const time = typeof input.time === "string" ? input.time.trim() : ""; if (!title || !time) return sendJson(res, 400, { ok: false, error: "title and time are required" }); const item = { id: crypto.randomUUID(), title, time, createdAt: new Date().toISOString() }; reminders.push(item); return sendJson(res, 201, { ok: true, item }); }
    if (req.method === "POST" && req.url === "/api/device-command") { const input = await parseJson(req); const deviceId = typeof input.deviceId === "string" ? input.deviceId : ""; const action = typeof input.action === "string" ? input.action : ""; if (!deviceId || !action) return sendJson(res, 400, { ok: false, error: "deviceId and action are required" }); const device = getDevice(deviceId); if (!device) return sendJson(res, 404, { ok: false, error: "Unknown device" }); if (input.approved !== true) return sendJson(res, 403, { ok: false, error: "Explicit confirmation is required", status: "confirmation_required", device }); const result = await sendAndroidCommand(deviceId, action, input.args && typeof input.args === "object" ? input.args : {}); return sendJson(res, result.ok === false ? 503 : 200, result); }
    if (req.method === "POST" && req.url === "/api/script-command") { const input = await parseJson(req); const scriptName = typeof input.scriptName === "string" ? input.scriptName : ""; const deviceId = typeof input.deviceId === "string" ? input.deviceId : "android-phone"; const script = getScript(scriptName); if (!script) return sendJson(res, 404, { ok: false, error: "Script is not registered" }); if (script.requiresConfirmation && input.approved !== true) return sendJson(res, 403, { ok: false, error: "Explicit confirmation is required", status: "confirmation_required" }); const result = await sendAndroidScript(deviceId, scriptName, input.args && typeof input.args === "object" ? input.args : {}); return sendJson(res, result.ok === false ? 503 : 200, result); }
    if (req.method === "POST" && req.url === "/api/chat/stream") { const input = await parseJson(req); sendSseHeaders(res); try { await streamAssistantReply(typeof input.message === "string" ? input.message : "", res); } catch (error) { sendSse(res, "error", { error: error.message }); if (!res.writableEnded) res.end(); } return; }
    if (req.method === "POST" && req.url === "/api/chat") { const input = await parseJson(req); const result = await assistantReply(typeof input.message === "string" ? input.message : ""); return sendJson(res, 200, { ok: true, ...result }); }
    return sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) { return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid request" }); }
});
server.listen(port, "0.0.0.0", () => console.log(`Jazz API listening on :${port} — local Ollama brain: ${llm.model}`));
