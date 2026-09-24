import { getDevice, sendAndroidCommand, sendAndroidScript } from "./device-bridge.mjs";
import { normalizeUtterance } from "./utterance-normalizer.mjs";

export const ANDROID_INTENTS_VERSION = "generic-companion-v20-understanding";

function deviceFor(text) {
  return /\btablet\b/i.test(text) ? "android-tablet" : "android-phone";
}

function stripWakePhrase(value) {
  return String(value || "")
    .replace(/^\s*(?:hey\s+)?jazz[,\s:-]*/i, "")
    .trim();
}

function extractAmount(text) {
  const value = String(text || "");
  const match =
    value.match(/(?:₹|rs\.?|inr\s*)\s*(\d+(?:\.\d+)?)/i) ||
    value.match(/\b(\d+(?:\.\d+)?)\s*(?:rupees?|rupee|rs)\b/i);
  return match ? Number(match[1]) : null;
}

function isUnlockCommand(text) {
  return /^unlock(?:\s+(?:my\s+)?(?:mobile|phone))?(?:\s+jazz)?[!. ]*$/i.test(text);
}

function isMomPaymentCommand(text) {
  return /\b(?:pay|send)\b[^,;\n]{0,90}?\b(?:my\s+)?(?:mom|momma|mummy)\b/i.test(text);
}

function isScreenshotCommand(text) {
  return /\b(?:take\s+(?:a\s+)?screenshot|screenshot\s+(?:my\s+)?phone)\b/i.test(text);
}

function isMobileStatusCommand(text) {
  return /^(?:what\s+is|what's|check|show)\s+(?:my\s+)?mobile\s+status[?.! ]*$/i.test(text);
}

function youtubePlayQuery(text) {
  if (!/\byoutube\b/i.test(text) || !/\bplay\b/i.test(text)) return null;
  const match = text.match(/(?:^|\band\s+)play\s+(.+?)(?:\s+(?:on|in)\s+youtube)?(?:\s+jazz)?[.!?]*$/i);
  if (!match) return null;
  return match[1]
    .replace(/^[\s'"‘’“”`]+|[\s'"‘’“”`.,!?;:]+$/g, "")
    .trim() || null;
}

function looksLikeAndroidCommand(text) {
  return [
    /^(?:open|launch|start)\s+.+/i,
    /^close\s+.+/i,
    /^(?:go\s+)?back$/i,
    /^(?:go\s+)?home(?:\s+screen)?$/i,
    /^(?:open\s+)?recent\s+apps$/i,
    /^open\s+notifications$/i,
    /^(?:scroll|swipe)\s+(?:up|down).*/i,
    /^(?:tap|click)\s+.+/i,
    /^long\s+press\s+.+/i,
    /^type\s+.+/i,
    /^clear\s+text$/i,
    /^search\s+.+/i,
    /^(?:message|whatsapp|whats\s*app|send\s+.+\s+to\s+.+\s+on\s+whats\s*app).*/i
  ].some(pattern => pattern.test(text));
}

export async function handleAndroidIntent(message) {
  // This is the existing Android command router. The only new step is conservative
  // interpretation before matching; execution still goes through the same bridge,
  // script registry, companion permissions and AccessibilityService controls.
  const understanding = normalizeUtterance(message, { source: "typed" });
  if (understanding.requiresClarification) {
    return {
      assistant: understanding.suggestion || "I’m not confident enough to execute that Android command. Please rephrase it.",
      executed: false,
      tool: "android.understanding",
      intentVersion: ANDROID_INTENTS_VERSION
    };
  }

  const text = stripWakePhrase(understanding.normalized);
  if (!text) return null;

  const deviceId = deviceFor(text);
  const device = getDevice(deviceId);
  if (!device) return { assistant: "I don't know that Android device yet." };

  try {
    if (isUnlockCommand(text)) {
      const result = await sendAndroidScript(deviceId, "unlockmobile", { request: text });
      return {
        assistant: result?.message || "unlockmobile.ps1 executed.",
        executed: result?.ok !== false,
        tool: "android.script",
        scriptName: "unlockmobile",
        intentVersion: ANDROID_INTENTS_VERSION,
        result
      };
    }

    if (isMomPaymentCommand(text)) {
      const amount = extractAmount(text);
      const result = await sendAndroidScript(deviceId, "paymom", { amount, request: text });
      return {
        assistant: result?.message || `pay-mom.ps1 started${amount !== null ? ` for ₹${amount}` : ""}.`,
        executed: result?.ok !== false,
        tool: "android.script",
        scriptName: "paymom",
        intentVersion: ANDROID_INTENTS_VERSION,
        result
      };
    }

    if (isScreenshotCommand(text)) {
      const result = await sendAndroidScript(deviceId, "screenshot", { request: text });
      return {
        assistant: result?.message || "Screenshot workflow completed.",
        executed: result?.ok !== false,
        tool: "android.script",
        scriptName: "screenshot",
        intentVersion: ANDROID_INTENTS_VERSION,
        result
      };
    }

    if (isMobileStatusCommand(text)) {
      const [info, screen] = await Promise.all([
        sendAndroidCommand(deviceId, "device_info", {}),
        sendAndroidCommand(deviceId, "screen_state", {})
      ]);
      const interactive = screen?.interactive === true ? "screen on" : "screen off";
      const locked = screen?.locked === true ? "locked" : "unlocked";
      const model = info?.model || device.name;
      return {
        assistant: `${model} is connected; ${interactive}, ${locked}.`,
        executed: true,
        tool: "android.status",
        intentVersion: ANDROID_INTENTS_VERSION,
        result: { info, screen }
      };
    }

    const youtubeQuery = youtubePlayQuery(text);
    if (youtubeQuery) {
      const result = await sendAndroidScript(deviceId, "youtube", { query: youtubeQuery, request: text });
      return {
        assistant: result?.message || `YouTube workflow started for ${youtubeQuery}.`,
        executed: result?.ok !== false,
        tool: "android.script",
        scriptName: "youtube",
        intentVersion: ANDROID_INTENTS_VERSION,
        result
      };
    }

    if (!looksLikeAndroidCommand(text)) return null;

    const result = await sendAndroidCommand(deviceId, "execute_command", { command: text });
    if (result?.ok === false) {
      return {
        assistant: result?.message || result?.error || "I couldn't complete that Android command.",
        executed: false,
        tool: "android.automation",
        intentVersion: ANDROID_INTENTS_VERSION,
        result
      };
    }

    return {
      assistant: result?.message || "Done, Mama.",
      executed: true,
      tool: "android.automation",
      intentVersion: ANDROID_INTENTS_VERSION,
      result
    };
  } catch (error) {
    return {
      assistant: `I couldn't complete that Android action: ${error instanceof Error ? error.message : String(error)}`,
      executed: false,
      tool: "android.automation",
      intentVersion: ANDROID_INTENTS_VERSION
    };
  }
}
