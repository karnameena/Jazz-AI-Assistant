import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const timers = new Map();
const audioCache = new Map();
const channelToReminder = new Map();
const playbackToChannel = new Map();
let synthesizeReminderSpeech = null;
let ariSocket = null;
let ariSocketReady = null;
let reminders = [];
let initialized = false;

function loadEnvFile() {
  const envPath = process.env.JAZZ_VOIP_ENV || path.join(process.cwd(), "services", "voip", ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

function config() {
  return {
    enabled: String(process.env.JAZZ_VOIP_ENABLED || "false").toLowerCase() === "true",
    ariUrl: String(process.env.JAZZ_ASTERISK_ARI_URL || "http://127.0.0.1:8088/ari").replace(/\/$/, ""),
    user: String(process.env.JAZZ_ASTERISK_ARI_USER || ""),
    password: String(process.env.JAZZ_ASTERISK_ARI_PASSWORD || ""),
    endpoint: String(process.env.JAZZ_ASTERISK_ENDPOINT || "PJSIP/7001"),
    app: String(process.env.JAZZ_ASTERISK_ARI_APP || "jazz-reminder"),
    audioBaseUrl: String(process.env.JAZZ_VOIP_AUDIO_BASE_URL || "http://127.0.0.1:8797").replace(/\/$/, ""),
    callerId: String(process.env.JAZZ_VOIP_CALLER_ID || "Jazz <7000>"),
    timezone: String(process.env.JAZZ_TIMEZONE || "Asia/Kolkata"),
    timezoneOffsetMinutes: Number(process.env.JAZZ_TIMEZONE_OFFSET_MINUTES || 330),
    ringTimeoutSeconds: Math.max(5, Number(process.env.JAZZ_VOIP_RING_TIMEOUT_SECONDS || 35))
  };
}

function storePath() {
  return path.join(process.cwd(), ".jazz", "reminders.json");
}

async function persist() {
  const file = storePath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(reminders, null, 2), "utf8");
  await fsp.rename(temp, file);
}

async function load() {
  try {
    const raw = await fsp.readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw);
    reminders = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn(`[Jazz VoIP] Could not load reminders: ${error.message}`);
    reminders = [];
  }
}

function localParts(now, offsetMinutes) {
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate()
  };
}

function buildInstant({ hour, minute, dayOffset = 0, now = new Date() }) {
  const cfg = config();
  const local = localParts(now, cfg.timezoneOffsetMinutes);
  const localMidnightUtc = Date.UTC(local.year, local.month, local.day + dayOffset, hour, minute, 0, 0);
  return new Date(localMidnightUtc - cfg.timezoneOffsetMinutes * 60_000);
}

function parseClock(hourRaw, minuteRaw, meridiemRaw) {
  let hour = Number(hourRaw);
  const minute = Number(minuteRaw || 0);
  const meridiem = String(meridiemRaw || "").toLowerCase();
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "am") hour = hour === 12 ? 0 : hour;
    if (meridiem === "pm") hour = hour === 12 ? 12 : hour + 12;
  }
  return { hour, minute };
}

export function parseReminderCommand(message, now = new Date()) {
  const raw = String(message || "").trim();
  const text = raw.replace(/^(?:hey\s+jazz[, ]*)/i, "").trim();
  const patterns = [
    /^(?:call\s+me\s+and\s+)?remind\s+me\s+(today|tomorrow)?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:to|that)\s+(.+)$/i,
    /^remind\s+me\s+(?:to|that)\s+(.+?)\s+(today|tomorrow)?\s*(?:at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
    /^call\s+me\s+(today|tomorrow)?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+and\s+remind\s+me\s+(?:to|that)\s+(.+)$/i
  ];

  let title;
  let dayWord;
  let hourRaw;
  let minuteRaw;
  let meridiem;
  let match = text.match(patterns[0]);
  if (match) {
    [, dayWord, hourRaw, minuteRaw, meridiem, title] = match;
  } else if ((match = text.match(patterns[1]))) {
    [, title, dayWord, hourRaw, minuteRaw, meridiem] = match;
  } else if ((match = text.match(patterns[2]))) {
    [, dayWord, hourRaw, minuteRaw, meridiem, title] = match;
  } else {
    return null;
  }

  const clock = parseClock(hourRaw, minuteRaw, meridiem);
  if (!clock || !title?.trim()) return null;
  let dayOffset = String(dayWord || "").toLowerCase() === "tomorrow" ? 1 : 0;
  let scheduled = buildInstant({ ...clock, dayOffset, now });
  if (!dayWord && scheduled.getTime() <= now.getTime() + 5_000) {
    dayOffset = 1;
    scheduled = buildInstant({ ...clock, dayOffset, now });
  }
  return { title: title.trim().replace(/[.?!]+$/, ""), scheduledAt: scheduled.toISOString(), delivery: "voip" };
}

function formatScheduled(iso) {
  const cfg = config();
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: cfg.timezone,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(new Date(iso));
}

function basicAuth() {
  const cfg = config();
  return `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64")}`;
}

function ensureVoipConfigured() {
  const cfg = config();
  if (!cfg.enabled) throw new Error("VoIP reminders are not enabled. Set JAZZ_VOIP_ENABLED=true in services/voip/.env.");
  if (!cfg.user || !cfg.password) throw new Error("Asterisk ARI credentials are not configured.");
  if (!cfg.endpoint) throw new Error("Asterisk reminder endpoint is not configured.");
  return cfg;
}

async function ariFetch(relativePath, options = {}) {
  const cfg = ensureVoipConfigured();
  const response = await fetch(`${cfg.ariUrl}${relativePath}`, {
    ...options,
    headers: {
      Authorization: basicAuth(),
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    signal: options.signal || AbortSignal.timeout(10_000)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text || null; }
  if (!response.ok) throw new Error(`Asterisk ARI ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

function ariWsUrl() {
  const cfg = config();
  const url = new URL(cfg.ariUrl.replace(/^http/i, "ws"));
  url.pathname = `${url.pathname.replace(/\/$/, "")}/events`;
  url.searchParams.set("app", cfg.app);
  url.searchParams.set("api_key", `${cfg.user}:${cfg.password}`);
  return url.toString();
}

async function ensureAriSocket() {
  ensureVoipConfigured();
  if (ariSocket?.readyState === WebSocket.OPEN) return;
  if (ariSocketReady) return ariSocketReady;
  if (typeof WebSocket !== "function") throw new Error("This Node.js runtime does not provide WebSocket support required by Asterisk ARI.");

  ariSocketReady = new Promise((resolve, reject) => {
    const socket = new WebSocket(ariWsUrl());
    const timer = setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error("Timed out connecting to Asterisk ARI events."));
    }, 5_000);

    socket.addEventListener("open", () => {
      clearTimeout(timer);
      ariSocket = socket;
      console.log("[Jazz VoIP] Asterisk ARI event channel connected.");
      resolve();
    });
    socket.addEventListener("message", event => void handleAriEvent(event.data));
    socket.addEventListener("close", () => {
      if (ariSocket === socket) ariSocket = null;
      ariSocketReady = null;
      console.warn("[Jazz VoIP] Asterisk ARI event channel closed.");
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      if (socket.readyState !== WebSocket.OPEN) reject(new Error("Could not connect to Asterisk ARI events."));
    });
  }).finally(() => {
    if (!ariSocket || ariSocket.readyState !== WebSocket.OPEN) ariSocketReady = null;
  });
  return ariSocketReady;
}

async function updateReminder(id, patch) {
  const index = reminders.findIndex(item => item.id === id);
  if (index < 0) return null;
  reminders[index] = { ...reminders[index], ...patch, updatedAt: new Date().toISOString() };
  await persist();
  return reminders[index];
}

async function handleAriEvent(raw) {
  let event;
  try { event = JSON.parse(String(raw)); } catch { return; }

  if (event.type === "StasisStart") {
    const reminderId = Array.isArray(event.args) ? event.args[0] : null;
    const channelId = event.channel?.id;
    if (!reminderId || !channelId || !audioCache.has(reminderId)) return;
    channelToReminder.set(channelId, reminderId);
    const audio = audioCache.get(reminderId);
    const mediaUrl = `${config().audioBaseUrl}/api/reminders/${encodeURIComponent(reminderId)}/audio.wav?token=${encodeURIComponent(audio.token)}`;
    try {
      const params = new URLSearchParams({ media: `sound:${mediaUrl}` });
      const playback = await ariFetch(`/channels/${encodeURIComponent(channelId)}/play?${params.toString()}`, { method: "POST" });
      if (playback?.id) playbackToChannel.set(playback.id, channelId);
      await updateReminder(reminderId, { status: "playing", answeredAt: new Date().toISOString(), lastError: null });
    } catch (error) {
      await updateReminder(reminderId, { status: "failed", lastError: error.message });
      try { await ariFetch(`/channels/${encodeURIComponent(channelId)}`, { method: "DELETE" }); } catch {}
    }
    return;
  }

  if (event.type === "PlaybackFinished") {
    const playbackId = event.playback?.id;
    const channelId = playbackToChannel.get(playbackId);
    if (!channelId) return;
    playbackToChannel.delete(playbackId);
    const reminderId = channelToReminder.get(channelId);
    channelToReminder.delete(channelId);
    if (reminderId) {
      await updateReminder(reminderId, { status: "completed", completedAt: new Date().toISOString(), lastError: null });
      setTimeout(() => audioCache.delete(reminderId), 60_000).unref?.();
    }
    try { await ariFetch(`/channels/${encodeURIComponent(channelId)}`, { method: "DELETE" }); } catch {}
    return;
  }

  if (event.type === "ChannelDestroyed") {
    const channelId = event.channel?.id;
    const reminderId = channelToReminder.get(channelId);
    if (!reminderId) return;
    channelToReminder.delete(channelId);
    const reminder = reminders.find(item => item.id === reminderId);
    if (reminder && !["completed", "failed"].includes(reminder.status)) {
      await updateReminder(reminderId, { status: "failed", lastError: event.cause_txt || "Call ended before reminder playback completed." });
    }
  }
}

async function originate(reminder) {
  const cfg = ensureVoipConfigured();
  await ensureAriSocket();
  const params = new URLSearchParams({
    endpoint: cfg.endpoint,
    app: cfg.app,
    appArgs: reminder.id,
    callerId: cfg.callerId,
    timeout: String(cfg.ringTimeoutSeconds)
  });
  return ariFetch(`/channels?${params.toString()}`, { method: "POST" });
}

async function fireReminder(id) {
  timers.delete(id);
  const reminder = reminders.find(item => item.id === id);
  if (!reminder || reminder.status !== "scheduled") return;
  if (!synthesizeReminderSpeech) {
    await updateReminder(id, { status: "failed", lastError: "Jazz TTS is not connected to the VoIP scheduler." });
    return;
  }
  try {
    const text = `Hey Mama. This is Jazz. Reminder: ${reminder.title}.`;
    const wav = await synthesizeReminderSpeech(text);
    const token = crypto.randomBytes(18).toString("hex");
    audioCache.set(id, { token, buffer: wav, createdAt: Date.now() });
    await updateReminder(id, { status: "calling", attempts: Number(reminder.attempts || 0) + 1, lastAttemptAt: new Date().toISOString(), lastError: null });
    await originate(reminder);
    setTimeout(() => {
      const current = reminders.find(item => item.id === id);
      if (current && ["calling", "playing"].includes(current.status)) void updateReminder(id, { status: "failed", lastError: "Reminder call timed out before playback completed." });
    }, (config().ringTimeoutSeconds + 90) * 1000).unref?.();
  } catch (error) {
    await updateReminder(id, { status: "failed", lastError: error instanceof Error ? error.message : String(error) });
    console.warn(`[Jazz VoIP] Reminder ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function schedule(reminder) {
  if (!reminder || reminder.status !== "scheduled") return;
  const due = new Date(reminder.scheduledAt).getTime();
  if (!Number.isFinite(due)) return;
  const delay = due - Date.now();
  if (delay <= 0) {
    const overdue = Math.abs(delay);
    if (overdue <= 5 * 60_000) setImmediate(() => void fireReminder(reminder.id));
    return;
  }
  const maxDelay = 2_000_000_000;
  const timer = setTimeout(() => {
    if (delay > maxDelay) schedule(reminder);
    else void fireReminder(reminder.id);
  }, Math.min(delay, maxDelay));
  timer.unref?.();
  timers.set(reminder.id, timer);
}

export async function initVoipReminders({ synthesize }) {
  if (initialized) return;
  synthesizeReminderSpeech = synthesize;
  await load();
  for (const reminder of reminders) schedule(reminder);
  initialized = true;
  console.log(`[Jazz VoIP] reminder scheduler ready; ${reminders.filter(item => item.status === "scheduled").length} scheduled.`);
  if (config().enabled) void ensureAriSocket().catch(error => console.warn(`[Jazz VoIP] ARI not ready yet: ${error.message}`));
}

export function listVoipReminders() {
  return reminders.map(item => ({ ...item }));
}

export async function createVoipReminder({ title, scheduledAt, delivery = "voip" }) {
  const cleanTitle = String(title || "").trim();
  const instant = new Date(scheduledAt);
  if (!cleanTitle) throw new Error("Reminder title is required.");
  if (!Number.isFinite(instant.getTime())) throw new Error("Reminder scheduled time is invalid.");
  if (instant.getTime() <= Date.now()) throw new Error("Reminder time must be in the future.");
  const item = {
    id: crypto.randomUUID(),
    title: cleanTitle,
    scheduledAt: instant.toISOString(),
    delivery,
    status: "scheduled",
    attempts: 0,
    createdAt: new Date().toISOString(),
    lastError: null
  };
  reminders.push(item);
  await persist();
  schedule(item);
  return { ...item };
}

export async function handleVoipReminderCommand(message) {
  const parsed = parseReminderCommand(message);
  if (!parsed) return null;
  const item = await createVoipReminder(parsed);
  return {
    assistant: `Got it, Mama ⏰📞 I’ll call you on ${formatScheduled(item.scheduledAt)} and remind you: **${item.title}**.`,
    mode: "voip-reminder",
    reminder: item
  };
}

export function getReminderAudio(id, token) {
  const item = audioCache.get(String(id));
  if (!item || !token || token !== item.token) return null;
  return item.buffer;
}

export async function callReminderNow(id) {
  const reminder = reminders.find(item => item.id === id);
  if (!reminder) throw new Error("Reminder not found.");
  await updateReminder(id, { status: "scheduled", scheduledAt: new Date(Date.now() + 500).toISOString(), lastError: null });
  schedule(reminders.find(item => item.id === id));
  return reminders.find(item => item.id === id);
}

export async function getVoipHealth() {
  const cfg = config();
  const base = {
    enabled: cfg.enabled,
    ariUrl: cfg.ariUrl,
    endpoint: cfg.endpoint,
    app: cfg.app,
    audioBaseUrl: cfg.audioBaseUrl,
    configured: Boolean(cfg.enabled && cfg.user && cfg.password && cfg.endpoint)
  };
  if (!base.configured) return { ...base, ok: false, error: "VoIP is not fully configured." };
  try {
    const info = await ariFetch("/asterisk/info", { method: "GET" });
    return { ...base, ok: true, asterisk: info?.system?.version || info?.build?.version || "reachable" };
  } catch (error) {
    return { ...base, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
