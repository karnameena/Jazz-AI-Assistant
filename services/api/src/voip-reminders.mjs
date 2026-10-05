import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

// Reminder persistence is shared by the Jazz dashboard and JazzWhatsApp.
// Legacy Linphone/Asterisk/SIP calling has been removed; JazzWhatsApp owns
// reminder messages and follow-up call UI through its own scheduler.
let reminders = [];
let initialized = false;
let persistenceQueue = Promise.resolve();

function config() {
  return {
    timezone: String(process.env.JAZZ_TIMEZONE || "Asia/Kolkata"),
    timezoneOffsetMinutes: Number(process.env.JAZZ_TIMEZONE_OFFSET_MINUTES || 330),
  };
}

function storePath() {
  return path.join(process.cwd(), ".jazz", "reminders.json");
}

async function persist() {
  const snapshot = JSON.stringify(reminders, null, 2);
  const operation = persistenceQueue.then(async () => {
    const file = storePath();
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await fsp.writeFile(temp, snapshot, "utf8");
    await fsp.rename(temp, file);
  });
  persistenceQueue = operation.catch(() => {});
  return operation;
}

async function load() {
  try {
    const raw = await fsp.readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw);
    reminders = Array.isArray(parsed) ? parsed : [];
    // Migrate old reminder records onto the current JazzWhatsApp delivery path.
    let changed = false;
    reminders = reminders.map(item => {
      if (item?.delivery === "jazzwhatsapp") return item;
      changed = true;
      return { ...item, delivery: "jazzwhatsapp" };
    });
    if (changed) await persist();
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn(`[Jazz Reminders] Could not load reminders: ${error.message}`);
    reminders = [];
  }
}

function localParts(now, offsetMinutes) {
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
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
  const relative = text.match(/^remind\s+me\s+in\s+(\d+)\s+(seconds?|minutes?|mins?|hours?)\s+to\s+(.+)$/i);
  if (relative) {
    const multiplier = /^hour/i.test(relative[2]) ? 3600000 : /^sec/i.test(relative[2]) ? 1000 : 60000;
    const delay = Number(relative[1]) * multiplier;
    if (delay <= 0 || delay > 365 * 86400000) return null;
    return { title: relative[3].trim(), scheduledAt: new Date(now.getTime() + delay).toISOString(), delivery: "jazzwhatsapp" };
  }

  const patterns = [
    /^(?:call\s+me\s+and\s+)?remind\s+me\s+(today|tomorrow)?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:to|that)\s+(.+)$/i,
    /^remind\s+me\s+(?:to|that)\s+(.+?)\s+(today|tomorrow)?\s*(?:at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
    /^call\s+me\s+(today|tomorrow)?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+and\s+remind\s+me\s+(?:to|that)\s+(.+)$/i,
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
  return {
    title: title.trim().replace(/[.?!]+$/, ""),
    scheduledAt: scheduled.toISOString(),
    delivery: "jazzwhatsapp",
  };
}

function formatScheduled(iso) {
  const cfg = config();
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: cfg.timezone,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export async function updateReminder(id, patch) {
  const index = reminders.findIndex(item => item.id === id);
  if (index < 0) return null;
  reminders[index] = { ...reminders[index], ...patch, updatedAt: new Date().toISOString() };
  await persist();
  return { ...reminders[index] };
}

export async function initVoipReminders() {
  if (initialized) return;
  await load();
  initialized = true;
  console.log(`[Jazz Reminders] JazzWhatsApp reminder store ready; ${reminders.filter(item => item.status === "scheduled").length} scheduled.`);
}

export function listVoipReminders() {
  return reminders.map(item => ({ ...item }));
}

export async function createVoipReminder({ title, scheduledAt, delivery = "jazzwhatsapp", escalationDelaySeconds = 120 }) {
  const cleanTitle = String(title || "").trim();
  const instant = new Date(scheduledAt);
  if (!cleanTitle) throw new Error("Reminder title is required.");
  if (!Number.isFinite(instant.getTime())) throw new Error("Reminder scheduled time is invalid.");
  if (instant.getTime() <= Date.now()) throw new Error("Reminder time must be in the future.");

  const item = {
    id: crypto.randomUUID(),
    title: cleanTitle,
    scheduledAt: instant.toISOString(),
    delivery: "jazzwhatsapp",
    escalationDelaySeconds: Math.min(3600, Math.max(15, Number(escalationDelaySeconds) || 120)),
    status: "scheduled",
    attempts: 0,
    createdAt: new Date().toISOString(),
    lastError: null,
  };
  reminders.push(item);
  await persist();
  return { ...item };
}

export async function handleVoipReminderCommand(message) {
  const parsed = parseReminderCommand(message);
  if (!parsed) return null;
  const item = await createVoipReminder(parsed);
  return {
    assistant: `Got it, Mama. I’ll message you on ${formatScheduled(item.scheduledAt)}: **${item.title}**. If you don’t acknowledge it, I’ll call you in JazzWhatsApp.`,
    mode: "jazzwhatsapp-reminder",
    reminder: item,
  };
}

// Compatibility exports while the API is migrated away from the old VoIP naming.
// They contain no SIP/Asterisk/Linphone implementation.
export function getReminderAudio() {
  return null;
}

export async function callReminderNow(id) {
  const reminder = reminders.find(item => item.id === id);
  if (!reminder) throw new Error("Reminder not found.");
  return updateReminder(id, {
    status: "scheduled",
    scheduledAt: new Date(Date.now() + 500).toISOString(),
    delivery: "jazzwhatsapp",
    lastError: null,
  });
}

export async function getVoipHealth() {
  return {
    ok: false,
    removed: true,
    replacement: "jazzwhatsapp",
    error: "Legacy SIP/Asterisk calling has been removed. JazzWhatsApp handles reminder messaging and follow-up calls.",
  };
}
