import { answerImage } from "./jazzwhatsapp/vision.mjs";
import { sanitizeJazzReply } from "./jazzwhatsapp/reply-quality.mjs";
import { createJazzWhatsApp } from "./jazzwhatsapp/index.mjs";
import http from "node:http";
import { devices, getDevice, sendAndroidCommand, sendAndroidScript } from "./device-bridge.mjs";
import { findScriptForMessage, getScript, listScripts } from "./script-registry.mjs";
import { handleAndroidIntent } from "./android-intents.mjs";
import { callOllama, ensureOllamaReady, getOllamaStatus, streamOllama, verifyModeModel } from "./ollama.mjs";
import { getTtsStatus, streamPiperRaw, synthesizeWithPiper } from "./tts.mjs";
import { debugUnderstanding, normalizeUtterance } from "./utterance-normalizer.mjs";
import { jazzSystemPrompt, localPersonalityReply } from "./jazz-personality.mjs";
import { getCodingAgentHealth, getCodingTask, handleCodingIntent, listCodingTasks } from "../../coding-agent/src/index.mjs";
import {
  callReminderNow,
  createVoipReminder,
  getReminderAudio,
  getVoipHealth,
  handleVoipReminderCommand,
  initVoipReminders,
  listVoipReminders
} from "./voip-reminders.mjs";

const VERSION = "0.10.4-local";
const port = Number(process.env.PORT || 8787);
const memories = [];
let pendingSensitiveAction = null;

const tools = [
  { name: "time", description: "Get the current server/local time", requiresConfirmation: false },
  { name: "weather", description: "Get weather from an approved provider", requiresConfirmation: false },
  { name: "android", description: "Execute an explicitly authorized Android action through the configured bridge", requiresConfirmation: true },
  { name: "scripts", description: "Execute explicitly registered Mama-owned Android scripts", requiresConfirmation: false },
  { name: "pc", description: "Execute an explicitly authorized PC action", requiresConfirmation: true },
  { name: "tts", description: "Speak Jazz replies with Piper or the browser fallback", requiresConfirmation: false },
  { name: "voip", description: "Schedule and deliver reminder calls through the configured local Asterisk SIP system", requiresConfirmation: false },
  { name: "coding", description: "Create and validate code in an isolated workspace with approval-gated dependency installation and integration", requiresConfirmation: false },
  { name: "ollama", description: "Run Jazz's local LLM brain through Ollama", requiresConfirmation: false },
  { name: "web", description: "Search the live web when an approved online provider is configured", requiresConfirmation: false }
];

const GEMINI_FALLBACKS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"];

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.end(JSON.stringify(payload));
}

function sendAudio(res, status, buffer) {
  res.statusCode = status;
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.end(buffer);
}

function sendSseHeaders(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.flushHeaders?.();
}

function sendSse(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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

function getCurrentTime() {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).format(new Date());
}

function extractAmount(text) {
  const match = String(text).match(/(?:₹|rs\.?|inr\s*)\s*(\d+(?:\.\d+)?)/i) || String(text).match(/\b(\d+(?:\.\d+)?)\s*(?:rupees|rs)\b/i);
  return match ? Number(match[1]) : null;
}

function deviceForMessage(text) { return /\btablet\b/i.test(text) ? "android-tablet" : "android-phone"; }

function normalizeLocalText(value) {
  return String(value || "")
    .trim()
    .replace(/^[*_`~\s]+/, "")
    .replace(/[*_`~\s]+$/, "")
    .trim();
}

function interpretIncomingMessage(message, source = "typed") {
  const understanding = normalizeUtterance(message, { source: source === "voice" ? "voice" : "typed" });
  debugUnderstanding(understanding);
  return {
    understanding,
    message: understanding.requiresClarification
      ? understanding.raw
      : (understanding.normalized || understanding.raw)
  };
}

function clarificationReply(understanding) {
  if (!understanding?.requiresClarification) return null;
  return {
    assistant: understanding.suggestion || "I’m not confident enough to execute that command. Please rephrase it.",
    mode: "clarification",
    executed: false
  };
}

function extractResponsesText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) if (typeof content?.text === "string") parts.push(content.text);
  }
  return parts.join("\n").trim() || null;
}

function extractGeminiText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const step of Array.isArray(data?.steps) ? data.steps : []) {
    if (step?.type !== "model_output") continue;
    for (const content of Array.isArray(step?.content) ? step.content : []) if (typeof content?.text === "string") parts.push(content.text);
  }
  return parts.join("\n").trim() || null;
}

function geminiModels() {
  const configured = process.env.JAZZ_LLM_MODEL || "gemini-3.8-flash";
  return [...new Set([configured, ...GEMINI_FALLBACKS])];
}

function transientGemini(status) { return [408, 429, 500, 502, 503, 504].includes(status); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function systemPrompt() {
  return jazzSystemPrompt(memories);
}

async function geminiRequest(message, model, systemInstruction, stream = false) {
  const key = process.env.JAZZ_LLM_API_KEY;
  if (!key) {
    const error = new Error("JAZZ_LLM_API_KEY is not configured");
    error.code = "missing_api_key";
    throw error;
  }
  const body = {
    model,
    input: message,
    system_instruction: systemInstruction,
    generation_config: {
      thinking_level: process.env.JAZZ_GEMINI_THINKING_LEVEL || "high",
      max_output_tokens: Number(process.env.JAZZ_MAX_OUTPUT_TOKENS || 8000)
    },
    store: false,
    stream
  };
  if (process.env.JAZZ_GEMINI_ENABLE_WEB_SEARCH === "true") body.tools = [{ type: "google_search" }];
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(`Gemini request failed (${response.status})${detail ? `: ${detail.slice(0, 320)}` : ""}`);
    error.status = response.status;
    throw error;
  }
  return response;
}

async function callGemini(message, systemInstruction) {
  let lastError = null;
  for (const model of geminiModels()) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await geminiRequest(message, model, systemInstruction, false);
        const data = await response.json();
        const text = extractGeminiText(data);
        if (text) return { text, model };
        throw new Error(`Gemini ${model} returned no text`);
      } catch (error) {
        lastError = error;
        if (error?.code === "missing_api_key") throw error;
        if (!transientGemini(error?.status)) break;
        if (attempt === 0) await sleep(350 + Math.floor(Math.random() * 250));
      }
    }
    console.warn(`[Jazz] Gemini model unavailable: ${model}${lastError ? ` — ${lastError.message}` : ""}`);
  }
  throw lastError || new Error("All Gemini models are unavailable");
}

async function streamGemini(message, systemInstruction, onText) {
  let lastError = null;
  for (const model of geminiModels()) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let started = false;
      try {
        const response = await geminiRequest(message, model, systemInstruction, true);
        if (!response.body) throw new Error("Gemini returned no stream body");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;
            let event;
            try { event = JSON.parse(raw); } catch { continue; }
            if (event?.event_type === "step.delta" && event?.delta?.type === "text" && typeof event.delta.text === "string") {
              started = true;
              await onText(event.delta.text, model);
            }
          }
        }
        if (!started) throw new Error(`Gemini ${model} completed without text`);
        return model;
      } catch (error) {
        lastError = error;
        if (error?.code === "missing_api_key") throw error;
        if (started || !transientGemini(error?.status)) break;
        if (attempt === 0) await sleep(350 + Math.floor(Math.random() * 250));
      }
    }
    console.warn(`[Jazz] Gemini stream unavailable: ${model}${lastError ? ` — ${lastError.message}` : ""}`);
  }
  throw lastError || new Error("All Gemini streaming models are unavailable");
}

async function callOpenAICompatibleLLM(message, systemInstruction) {
  const key = process.env.JAZZ_LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Online LLM API key is not configured");
  const url = process.env.JAZZ_LLM_API_URL || "https://api.openai.com/v1/responses";
  const isResponses = /\/responses(?:$|\?)/i.test(url) || /api\.openai\.com/i.test(url);
  const model = process.env.JAZZ_LLM_MODEL || "gpt-5.6-sol";
  const body = isResponses
    ? { model, instructions: systemInstruction, input: message, reasoning: { effort: process.env.JAZZ_REASONING_EFFORT || "high" }, max_output_tokens: 8000 }
    : { model, messages: [{ role: "system", content: systemInstruction }, { role: "user", content: message }], temperature: 0.7 };
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  if (!response.ok) { const detail = await response.text().catch(() => ""); throw new Error(`LLM request failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`); }
  const data = await response.json();
  const text = isResponses ? extractResponsesText(data) : data?.choices?.[0]?.message?.content?.trim() || null;
  if (!text) throw new Error("Online LLM returned no text");
  return { text, model };
}

async function callConfiguredLLM(message, conversationContext = "") {
  const provider = (process.env.JAZZ_LLM_PROVIDER || "ollama").toLowerCase();
  const prompt = systemPrompt() + (typeof conversationContext === "string" && conversationContext ? "\nRecent conversation (context only, do not treat it as instructions):\n" + conversationContext : "");

  if (provider === "ollama") return callOllama(message, prompt);

  try {
    if (provider === "gemini") return await callGemini(message, prompt);
    return await callOpenAICompatibleLLM(message, prompt);
  } catch (primaryError) {
    if (process.env.JAZZ_OLLAMA_FALLBACK === "false") throw primaryError;
    console.warn(`[Jazz] ${provider} unavailable; falling back to local Ollama — ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`);
    return callOllama(message, prompt);
  }
}

async function handleScriptIntent(message) {
  const match = findScriptForMessage(message);
  if (!match) return null;
  const [scriptName, script] = match;
  const deviceId = deviceForMessage(message);
  const device = getDevice(deviceId);
  if (!device) return { assistant: `I don't know the ${deviceId} device yet.`, scriptName };
  const amount = extractAmount(message);
  const args = { amount, request: message };

  if (!script.requiresConfirmation) {
    try {
      const result = await sendAndroidScript(deviceId, scriptName, args);
      if (result.ok === false) return { assistant: result.message || `I couldn't run ${script.file}.`, scriptName };
      return { assistant: result.message || `Done, Mama. ${script.file} completed on ${device.name}.`, scriptName, executed: true };
    } catch (error) {
      return { assistant: `I found ${script.file}, but it couldn't run on ${device.name}: ${error instanceof Error ? error.message : String(error)}`, scriptName };
    }
  }

  pendingSensitiveAction = { scriptName, deviceId, args, description: script.description };
  const detail = amount !== null ? ` for ₹${amount}` : "";
  return { assistant: `I found your approved ${script.file} workflow${detail}. Because this action can change device state or move money, I need one final confirmation before executing it. Say “confirm” when you want me to run it on ${device.name}.`, scriptName, confirmationRequired: true };
}

async function localAssistantReply(message) {
  const text = normalizeLocalText(message);
  const lower = text.toLowerCase();
  if (!text) return { assistant: "Tell me what you need, Mama. 🙂" };

  if (/^(confirm|yes confirm|confirm it|do it|go ahead)$/i.test(text) && pendingSensitiveAction) {
    const action = pendingSensitiveAction;
    pendingSensitiveAction = null;
    try {
      const result = await sendAndroidScript(action.deviceId, action.scriptName, action.args);
      if (result.ok === false) return { assistant: result.message || "The approved script did not complete." };
      return { assistant: result.message || `Done, Mama. ${action.scriptName} completed. ✅`, executed: true };
    } catch (error) {
      return { assistant: `I couldn't execute ${action.scriptName}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  if (/^(?:hey\s+|hi\s+|hello\s+)?jazz[!.? ]*$/i.test(text) || /^(hi|hello|hey)[!.? ]*$/i.test(text)) {
    return { assistant: "Hey Mama 👋😎 I'm here and listening. What do you want me to do?", mode: "local-wake" };
  }

  if (/^(?:hey\s+)?jazz[, ]+(?:can you hear me|are you there|you there)[!.? ]*$/i.test(text)) {
    return { assistant: "Yep, Mama 🎙️ I can hear you. I'm ready.", mode: "local-wake" };
  }

  const personality = localPersonalityReply(text, tools);
  if (personality) return personality;

  const reminder = await handleVoipReminderCommand(text);
  if (reminder) return reminder;

  const coding = await handleCodingIntent(text);
  if (coding) return coding;

  const androidIntent = await handleAndroidIntent(text);
  if (androidIntent) return androidIntent;

  const scripted = await handleScriptIntent(text);
  if (scripted) return scripted;

  if (/^(?:what(?:'s| is)\s+)?(?:the\s+)?(?:current\s+)?time(?:\s+is\s+it)?(?:\s+in\s+india)?[?.! ]*$/i.test(text)) return { assistant: `Mama ⏰ the current time in India is ${getCurrentTime()}.` };
  if (/\b(where are you|where r u|where are u|where're you)\b/i.test(text)) return { assistant: "Right here with you, Mama 👋😎 Jazz is online and ready." };
  if (lower.includes("remember") || lower.includes("memory")) return { assistant: "Absolutely, Mama 🧠 Tell me what you want Jazz to remember." };
  if (lower.includes("remind") || lower.includes("reminder")) return { assistant: "Sure, Mama ⏰ Tell me what I should remind you about and the exact time, for example: **remind me at 7 PM to take medicine**." };
  return null;
}

function brainUnavailableReply(error) {
  const detail = error instanceof Error ? error.message : String(error || "unknown error");
  return {
    assistant: `Mama 🧠 Jazz is online, but the local brain isn't ready yet. ${detail}`,
    mode: "brain-unavailable"
  };
}

async function assistantReplyPrepared(message, conversationContext = "") {
  const local = await localAssistantReply(message);
  if (local) return local;
  try {
    const result = await callConfiguredLLM(String(message).trim(), conversationContext);
    if (result?.text) return { assistant: result.text, mode: "llm", model: result.model };
  } catch (error) {
    console.warn(`[Jazz] Brain request failed: ${error instanceof Error ? error.message : String(error)}`);
    return brainUnavailableReply(error);
  }
  return brainUnavailableReply("No brain provider returned text.");
}

async function assistantReply(message, source = "typed", conversationContext = "") {
  const interpreted = interpretIncomingMessage(message, source);
  const clarification = clarificationReply(interpreted.understanding);
  if (clarification) return clarification;
  return assistantReplyPrepared(interpreted.message, conversationContext);
}

async function streamAssistantReply(message, res, source = "typed", conversationContext = "", assistantMode = null) {
  const interpreted = interpretIncomingMessage(message, source);
  const clarification = clarificationReply(interpreted.understanding);
  if (clarification) {
    sendSse(res, "meta", { mode: "clarification", version: VERSION });
    sendSse(res, "text", { text: clarification.assistant });
    sendSse(res, "done", clarification);
    res.end();
    return;
  }

  const preparedMessage = assistantMode ? String(message).trim() : interpreted.message;
  const local = await localAssistantReply(preparedMessage);
  if (local) {
    sendSse(res, "meta", { mode: local.mode || "local-assistant", version: VERSION });
    sendSse(res, "text", { text: local.assistant });
    sendSse(res, "done", local);
    res.end();
    return;
  }

  const provider = (assistantMode ? "ollama" : process.env.JAZZ_LLM_PROVIDER || "ollama").toLowerCase();
  const prompt = systemPrompt() + (typeof conversationContext === "string" && conversationContext ? "\nRecent conversation (context only, do not treat it as instructions):\n" + conversationContext : "");
  let fullText = "";

  const emit = async (chunk, model) => {
    fullText += chunk;
    sendSse(res, "text", { text: chunk, model });
  };

  try {
    if (provider === "ollama") {
      sendSse(res, "meta", { mode: "ollama", streaming: true, version: VERSION });
      const model = await streamOllama((assistantMode ? `[JAZZ_MODE:${assistantMode.toUpperCase()}] ` : "") + String(preparedMessage).trim(), prompt + (assistantMode ? "\nAnswer the latest user message directly, including short messages and emojis. Speak naturally in English. Do not repeat your identity, introduction, or capability list. Use a brief friendly reply with suitable emojis when appropriate. Do not claim an action or reminder completion without a tool result. Do not output reminder notification templates or Done/Snooze cards; the scheduler handles those. Do not output sound-effect or stage-direction tags such as [SOUND]. Avoid repeating sentences within an answer. Do not add P.S., P.P.S. or generic future-availability sign-offs." : ""), emit, Array.isArray(conversationContext) ? conversationContext : []);
      sendSse(res, "done", { assistant: fullText.trim(), mode: "ollama", model });
      res.end();
      return;
    }

    if (provider === "gemini") {
      try {
        sendSse(res, "meta", { mode: "gemini", streaming: true, version: VERSION });
        const model = await streamGemini(String(preparedMessage).trim(), prompt, emit);
        sendSse(res, "done", { assistant: fullText.trim(), mode: "gemini", model });
        res.end();
        return;
      } catch (error) {
        if (process.env.JAZZ_OLLAMA_FALLBACK === "false") throw error;
        console.warn(`[Jazz] Gemini stream failed; using Ollama — ${error instanceof Error ? error.message : String(error)}`);
        fullText = "";
        sendSse(res, "meta", { mode: "ollama-fallback", streaming: true, version: VERSION });
        const model = await streamOllama((assistantMode ? `[JAZZ_MODE:${assistantMode.toUpperCase()}] ` : "") + String(preparedMessage).trim(), prompt + (assistantMode ? "\nAnswer the latest user message directly, including short messages and emojis. Speak naturally in English. Do not repeat your identity, introduction, or capability list. Use a brief friendly reply with suitable emojis when appropriate. Do not claim an action or reminder completion without a tool result. Do not output reminder notification templates or Done/Snooze cards; the scheduler handles those. Do not output sound-effect or stage-direction tags such as [SOUND]. Avoid repeating sentences within an answer. Do not add P.S., P.P.S. or generic future-availability sign-offs." : ""), emit, Array.isArray(conversationContext) ? conversationContext : []);
        sendSse(res, "done", { assistant: fullText.trim(), mode: "ollama-fallback", model });
        res.end();
        return;
      }
    }

    const result = await assistantReplyPrepared(preparedMessage);
    sendSse(res, "meta", { mode: result.mode || "llm", model: result.model || null, version: VERSION });
    sendSse(res, "text", { text: result.assistant });
    sendSse(res, "done", result);
    res.end();
  } catch (error) {
    const result = brainUnavailableReply(error);
    sendSse(res, "meta", { mode: result.mode, version: VERSION });
    sendSse(res, "text", { text: result.assistant });
    sendSse(res, "done", result);
    res.end();
  }
}

async function streamTtsReply(text, res) {
  sendSse(res, "meta", { mode: "piper", format: "pcm16le", sampleRate: 22050, channels: 1 });
  let bytes = 0;
  await streamPiperRaw(text, chunk => {
    bytes += chunk.length;
    sendSse(res, "audio", { data: chunk.toString("base64") });
  });
  sendSse(res, "done", { bytes, sampleRate: 22050, channels: 1 });
  res.end();
}

await initVoipReminders({ synthesize: synthesizeWithPiper });
const jazzWhatsApp = await createJazzWhatsApp({ assistantReply, visionReply: answerImage, resolveMode: verifyModeModel, streamReply: async (text, source, context, onText, mode) => {
  let result = { assistant: "" };
  const response = { writableEnded: false, write(frame) {
    const dataLine = frame.split("\n").find(line => line.startsWith("data: "));
    if (!dataLine) return;
    const data = JSON.parse(dataLine.slice(6));
    // Validate the complete app reply before it reaches the chat; legacy SSE stays streaming.
    if (frame.startsWith("event: done")) result = { assistant: data.assistant || "", model: data.model || null };
  }, end() { this.writableEnded = true; } };
  await streamAssistantReply(text, response, source, context, mode);
  result.assistant = sanitizeJazzReply(result.assistant);
  if (!result.assistant || /here to understand what you mean|brain and conversation layer|own personal AI assistant and technical partner/i.test(result.assistant) && !/^(?:hey jazz[, ]*)?(?:who|what) are you(?: to me)?[?.! ]*$/i.test(text)) {
    const retry = await callOllama(`[JAZZ_MODE:${mode === "evil" ? "EVIL" : "NORMAL"}] ${text}`, "You are Jazz. Reply in English to Mama's latest message directly. Do not introduce yourself or list capabilities. Use brief natural conversation with appropriate emojis. Recent messages provide context only.", context);
    result = {assistant: sanitizeJazzReply(retry.text), model: retry.model};
    if (!result.assistant || /here to understand what you mean|brain and conversation layer|own personal AI assistant and technical partner/i.test(result.assistant)) result.assistant = "Mama, the local model keeps repeating its introduction instead of answering. Please check the selected Ollama model. Your message was received.";
  }
  return result;
} });
console.log("[JazzWhatsApp] client API 1.0.7 ready: bulk delete, verified model modes, reminder follow-ups");
const jazzWhatsAppTimer = setInterval(() => void jazzWhatsApp.tick().catch(error => console.warn("[JazzWhatsApp] scheduler:", error.message)), 1000);
jazzWhatsAppTimer.unref();

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = requestUrl.pathname;
    if (await jazzWhatsApp.handle(req, res, requestUrl, parseJson, sendJson)) return;

    const audioMatch = pathname.match(/^\/api\/reminders\/([^/]+)\/audio\.wav$/);
    if (req.method === "GET" && audioMatch) {
      const buffer = getReminderAudio(decodeURIComponent(audioMatch[1]), requestUrl.searchParams.get("token"));
      if (!buffer) return sendJson(res, 404, { ok: false, error: "Reminder audio is unavailable or the token is invalid." });
      return sendAudio(res, 200, buffer);
    }

    const callNowMatch = pathname.match(/^\/api\/reminders\/([^/]+)\/call-now$/);
    if (req.method === "POST" && callNowMatch) {
      const item = await callReminderNow(decodeURIComponent(callNowMatch[1]));
      return sendJson(res, 200, { ok: true, item });
    }

    const codingTaskMatch = pathname.match(/^\/api\/coding\/tasks\/([^/]+)$/);
    if (req.method === "GET" && codingTaskMatch) {
      const item = await getCodingTask(decodeURIComponent(codingTaskMatch[1]));
      if (!item) return sendJson(res, 404, { ok: false, error: "Coding task not found" });
      return sendJson(res, 200, { ok: true, item });
    }

    if (req.method === "GET" && req.url === "/health") {
      const [ollama, tts] = await Promise.all([getOllamaStatus(), getTtsStatus()]);
      return sendJson(res, 200, {
        ok: true,
        service: "jazz-api",
        version: VERSION,
        provider: process.env.JAZZ_LLM_PROVIDER || "ollama",
        ollama,
        tts,
        streaming: true,
        ttsStreaming: true
      });
    }
    if (req.method === "GET" && req.url === "/api/brain-health") return sendJson(res, 200, { ok: true, version: VERSION, provider: process.env.JAZZ_LLM_PROVIDER || "ollama", ollama: await getOllamaStatus() });
    if (req.method === "GET" && req.url === "/api/tts-health") return sendJson(res, 200, { ok: true, version: VERSION, tts: await getTtsStatus() });
    if (req.method === "GET" && req.url === "/api/voip/health") return sendJson(res, 200, { ok: true, voip: await getVoipHealth() });
    if (req.method === "GET" && req.url === "/api/coding/health") return sendJson(res, 200, { ok: true, coding: await getCodingAgentHealth() });
    if (req.method === "GET" && req.url === "/api/coding/tasks") return sendJson(res, 200, { ok: true, items: await listCodingTasks() });
    if (req.method === "GET" && req.url === "/api/tools") return sendJson(res, 200, { ok: true, tools });
    if (req.method === "GET" && req.url === "/api/scripts") return sendJson(res, 200, { ok: true, items: listScripts() });
    if (req.method === "GET" && req.url === "/api/devices") return sendJson(res, 200, { ok: true, items: devices });
    if (req.method === "GET" && req.url === "/api/time") return sendJson(res, 200, { ok: true, time: getCurrentTime(), timeZone: "Asia/Kolkata" });
    if (req.method === "GET" && req.url === "/api/memory") return sendJson(res, 200, { ok: true, items: memories });
    if (req.method === "GET" && req.url === "/api/reminders") return sendJson(res, 200, { ok: true, items: listVoipReminders() });

    if (req.method === "POST" && req.url === "/api/tts") {
      const input = await parseJson(req);
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (!text) return sendJson(res, 400, { ok: false, error: "text is required" });
      return sendAudio(res, 200, await synthesizeWithPiper(text));
    }

    if (req.method === "POST" && req.url === "/api/tts/stream") {
      const input = await parseJson(req);
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (!text) return sendJson(res, 400, { ok: false, error: "text is required" });
      sendSseHeaders(res);
      try { await streamTtsReply(text, res); }
      catch (error) { sendSse(res, "error", { error: error instanceof Error ? error.message : "Piper streaming failed" }); if (!res.writableEnded) res.end(); }
      return;
    }

    if (req.method === "POST" && req.url === "/api/memory") {
      const input = await parseJson(req);
      const content = typeof input.content === "string" ? input.content.trim() : "";
      if (!content) return sendJson(res, 400, { ok: false, error: "content is required" });
      const item = { id: crypto.randomUUID(), content, createdAt: new Date().toISOString() };
      memories.push(item);
      return sendJson(res, 201, { ok: true, item });
    }

    if (req.method === "POST" && req.url === "/api/reminders") {
      const input = await parseJson(req);
      const title = typeof input.title === "string" ? input.title.trim() : "";
      const scheduledAt = typeof input.scheduledAt === "string" ? input.scheduledAt.trim() : (typeof input.time === "string" ? input.time.trim() : "");
      if (!title || !scheduledAt) return sendJson(res, 400, { ok: false, error: "title and scheduledAt/time are required" });
      const item = await createVoipReminder({ title, scheduledAt, delivery: process.env.JAZZ_REMINDER_DELIVERY === "jazzwhatsapp" ? "jazzwhatsapp" : "voip" });
      return sendJson(res, 201, { ok: true, item });
    }

    if (req.method === "POST" && req.url === "/api/device-command") {
      const input = await parseJson(req);
      const deviceId = typeof input.deviceId === "string" ? input.deviceId : "";
      const action = typeof input.action === "string" ? input.action : "";
      if (!deviceId || !action) return sendJson(res, 400, { ok: false, error: "deviceId and action are required" });
      const device = getDevice(deviceId);
      if (!device) return sendJson(res, 404, { ok: false, error: "Unknown device" });
      if (input.approved !== true) return sendJson(res, 403, { ok: false, error: "Explicit confirmation is required", status: "confirmation_required", device });
      const result = await sendAndroidCommand(deviceId, action, input.args && typeof input.args === "object" ? input.args : {});
      return sendJson(res, result.ok === false ? 503 : 200, result);
    }

    if (req.method === "POST" && req.url === "/api/script-command") {
      const input = await parseJson(req);
      const scriptName = typeof input.scriptName === "string" ? input.scriptName : "";
      const deviceId = typeof input.deviceId === "string" ? input.deviceId : "android-phone";
      const script = getScript(scriptName);
      if (!script) return sendJson(res, 404, { ok: false, error: "Script is not registered" });
      if (script.requiresConfirmation && input.approved !== true) return sendJson(res, 403, { ok: false, error: "Explicit confirmation is required", status: "confirmation_required" });
      const result = await sendAndroidScript(deviceId, scriptName, input.args && typeof input.args === "object" ? input.args : {});
      return sendJson(res, result.ok === false ? 503 : 200, result);
    }

    if (req.method === "POST" && req.url === "/api/chat/stream") {
      const input = await parseJson(req);
      const message = typeof input.message === "string" ? input.message : "";
      const source = input.source === "voice" ? "voice" : "typed";
      sendSseHeaders(res);
      await streamAssistantReply(message, res, source);
      return;
    }

    if (req.method === "POST" && req.url === "/api/chat") {
      const input = await parseJson(req);
      const source = input.source === "voice" ? "voice" : "typed";
      const result = await assistantReply(typeof input.message === "string" ? input.message : "", source);
      return sendJson(res, 200, { ok: true, version: VERSION, ...result });
    }

    return sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid request" });
  }
});

jazzWhatsApp.attach(server);
server.listen(port, "0.0.0.0", () => {
  console.log(`[Jazz] API ${VERSION} listening on :${port}`);
  void initVoipReminders({ synthesize: synthesizeWithPiper }).catch(error => console.warn(`[Jazz VoIP] scheduler startup failed: ${error instanceof Error ? error.message : String(error)}`));
  void ensureOllamaReady().then(status => {
    if (status.ok) console.log(`[Jazz] Ollama ready at ${status.url}; models: ${status.models.join(", ") || "none installed"}`);
    else console.warn(`[Jazz] Ollama unavailable at ${status.url}: ${status.error || "not reachable"}`);
  });
  void getTtsStatus().then(status => {
    if (status.ok) console.log(`[Jazz] Piper ready: ${status.executable}`);
    else console.warn(`[Jazz] Piper not installed completely; browser TTS fallback will be used. Setup: ${status.setupScript}`);
  });
});
