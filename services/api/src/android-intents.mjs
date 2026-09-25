import { getDevice, sendAndroidCommand, sendAndroidScript } from "./device-bridge.mjs";
import { debugUnderstanding, normalizeUtterance } from "./utterance-normalizer.mjs";

export const ANDROID_INTENTS_VERSION = "generic-companion-v24-screen-aware";

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
  const match = value.match(/(?:₹|rs\.?|inr\s*)\s*(\d+(?:\.\d+)?)/i)
    || value.match(/\b(\d+(?:\.\d+)?)\s*(?:rupees?|rupee|rs)\b/i);
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

function isInstagramReelCommand(text) {
  return /\binstagram\b/i.test(text) && /\b(?:reel|reels|video|videos)\b/i.test(text);
}

function isInstagramLikeCommand(text) {
  return /^(?:like|heart)(?:\s+(?:this|the|current))?\s+(?:reel|video)[.!? ]*$/i.test(text)
    || /^double\s+tap(?:\s+(?:this|the|current))?\s+(?:reel|video)[.!? ]*$/i.test(text);
}

function directNavigationAction(text) {
  if (/^(?:go\s+)?home(?:\s+screen)?[.!? ]*$/i.test(text)) return "home";
  if (/^(?:go\s+)?back(?:\s+one\s+step)?[.!? ]*$/i.test(text)) return "back";
  if (/^(?:scroll|swipe)\s+up[.!? ]*$/i.test(text)) return "scroll_up";
  if (/^(?:scroll|swipe)\s+down[.!? ]*$/i.test(text)) return "scroll_down";
  if (/^(?:scroll|swipe)\s+left[.!? ]*$/i.test(text)) return "swipe_left";
  if (/^(?:scroll|swipe)\s+right[.!? ]*$/i.test(text)) return "swipe_right";
  return null;
}

function directSystemAction(text) {
  if (/^(?:pause|pause\s+(?:it|music|media|this))[.!? ]*$/i.test(text)) return { action: "media_pause", args: {} };
  if (/^(?:play|resume|play\s+(?:it|music|media|again))[.!? ]*$/i.test(text)) return { action: "media_play", args: {} };
  if (/^(?:next\s+(?:song|track)|skip\s+(?:song|track))[.!? ]*$/i.test(text)) return { action: "media_next", args: {} };
  if (/^(?:previous\s+(?:song|track)|previous)[.!? ]*$/i.test(text)) return { action: "media_previous", args: {} };
  if (/^(?:increase|raise|turn\s+up)\s+(?:the\s+)?volume[.!? ]*$/i.test(text)) return { action: "volume_up", args: {} };
  if (/^(?:decrease|lower|turn\s+down)\s+(?:the\s+)?volume[.!? ]*$/i.test(text)) return { action: "volume_down", args: {} };
  if (/^mute(?:\s+(?:the\s+)?(?:phone|media|volume))?[.!? ]*$/i.test(text)) return { action: "mute", args: {} };
  if (/^unmute(?:\s+(?:the\s+)?(?:phone|media|volume))?[.!? ]*$/i.test(text)) return { action: "unmute", args: {} };
  if (/^(?:turn\s+)?(?:the\s+)?flash(?:light)?\s+on[.!? ]*$/i.test(text)) return { action: "flashlight_on", args: {} };
  if (/^(?:turn\s+)?(?:the\s+)?flash(?:light)?\s+off[.!? ]*$/i.test(text)) return { action: "flashlight_off", args: {} };
  if (/^(?:answer|answer\s+the\s+call)[.!? ]*$/i.test(text)) return { action: "answer_call", args: {} };
  if (/^(?:end|hang\s+up|end\s+the\s+call)[.!? ]*$/i.test(text)) return { action: "end_call", args: {} };
  const call = text.match(/^call\s+(.+?)[.!? ]*$/i);
  if (call) return { action: "call_contact", args: { contact: call[1].trim() } };
  return null;
}

function youtubePlayQuery(text) {
  if (!/\byoutube\b/i.test(text) || !/\bplay\b/i.test(text)) return null;
  const match = text.match(/(?:^|\band\s+)play\s+(.+?)(?:\s+(?:on|in)\s+youtube)?(?:\s+jazz)?[.!?]*$/i);
  if (!match) return null;
  return match[1].replace(/^[\s'"‘’“”`]+|[\s'"‘’“”`.,!?;:]+$/g, "").trim() || null;
}

function looksLikeAndroidCommand(text) {
  return [
    /^(?:open|launch|start)\s+.+/i,
    /^close\s+.+/i,
    /^(?:go\s+)?back/i,
    /^(?:go\s+)?home/i,
    /^(?:open\s+)?recent\s+apps/i,
    /^open\s+notifications/i,
    /^(?:scroll|swipe)\s+(?:up|down|left|right).*/i,
    /^(?:like|heart)(?:\s+(?:this|the|current))?\s+(?:reel|video)/i,
    /^double\s+tap/i,
    /^(?:tap|click|press)\s+.+/i,
    /^long\s+press\s+.+/i,
    /^type\s+.+/i,
    /^clear\s+text/i,
    /^search\s+.+/i,
    /^(?:pause|play|resume|next\s+(?:song|track)|previous\s+(?:song|track)|increase\s+volume|decrease\s+volume|mute|unmute)/i,
    /^(?:turn\s+)?(?:the\s+)?flash(?:light)?\s+(?:on|off)/i,
    /^(?:call\s+.+|answer(?:\s+the\s+call)?|end(?:\s+the\s+call)?|hang\s+up)/i,
    /^(?:message|whatsapp|whats\s*app|send\s+.+\s+to\s+.+\s+on\s+whats\s*app).*/i
  ].some(pattern => pattern.test(text));
}

export async function handleAndroidIntent(message) {
  const understanding = normalizeUtterance(message, { source: "typed" });
  debugUnderstanding(understanding);
  if (understanding.requiresClarification) {
    return {
      assistant: understanding.suggestion || "I’m not confident enough to execute that Android command. Please rephrase it.",
      executed: false,
      tool: "android.understanding",
      intentVersion: ANDROID_INTENTS_VERSION
    };
  }

  const hadWakeWord = /^\s*(?:hey\s+)?jazz\b/i.test(understanding.normalized);
  const text = stripWakePhrase(understanding.normalized);
  if (!text && hadWakeWord) {
    return {
      assistant: "Hey Mama 👋 I'm here and listening. What do you want me to do?",
      executed: false,
      mode: "local-wake",
      tool: "understanding.wake",
      intentVersion: ANDROID_INTENTS_VERSION
    };
  }
  if (hadWakeWord && /^(?:can you hear me|are you there|you there)[?.! ]*$/i.test(text)) {
    return {
      assistant: "Yes, Mama. I can hear you. I'm ready.",
      executed: false,
      mode: "local-wake",
      tool: "understanding.wake",
      intentVersion: ANDROID_INTENTS_VERSION
    };
  }
  if (!text) return null;

  const deviceId = deviceFor(text);
  const device = getDevice(deviceId);
  if (!device) return { assistant: "I don't know that Android device yet." };

  try {
    if (isUnlockCommand(text)) {
      const result = await sendAndroidScript(deviceId, "unlockmobile", { request: text });
      return { assistant: result?.message || "unlockmobile.ps1 executed.", executed: result?.ok !== false, tool: "android.script", scriptName: "unlockmobile", intentVersion: ANDROID_INTENTS_VERSION, result };
    }

    if (isMomPaymentCommand(text)) {
      const amount = extractAmount(text);
      const result = await sendAndroidScript(deviceId, "paymom", { amount, request: text });
      return { assistant: result?.message || `pay-mom.ps1 started${amount !== null ? ` for ₹${amount}` : ""}.`, executed: result?.ok !== false, tool: "android.script", scriptName: "paymom", intentVersion: ANDROID_INTENTS_VERSION, result };
    }

    if (isScreenshotCommand(text)) {
      const result = await sendAndroidScript(deviceId, "screenshot", { request: text });
      return { assistant: result?.message || "Screenshot workflow completed.", executed: result?.ok !== false, tool: "android.script", scriptName: "screenshot", intentVersion: ANDROID_INTENTS_VERSION, result };
    }

    if (isMobileStatusCommand(text)) {
      const [info, screen] = await Promise.all([
        sendAndroidCommand(deviceId, "device_info", {}),
        sendAndroidCommand(deviceId, "screen_state", {})
      ]);
      const interactive = screen?.interactive === true ? "screen on" : "screen off";
      const locked = screen?.locked === true ? "locked" : "unlocked";
      const model = info?.model || device.name;
      return { assistant: `${model} is connected; ${interactive}, ${locked}.`, executed: true, tool: "android.status", intentVersion: ANDROID_INTENTS_VERSION, result: { info, screen } };
    }

    const youtubeQuery = youtubePlayQuery(text);
    if (youtubeQuery) {
      const result = await sendAndroidScript(deviceId, "youtube", { query: youtubeQuery, request: text });
      return { assistant: result?.message || `YouTube workflow started for ${youtubeQuery}.`, executed: result?.ok !== false, tool: "android.script", scriptName: "youtube", intentVersion: ANDROID_INTENTS_VERSION, result };
    }

    if (isInstagramReelCommand(text) || isInstagramLikeCommand(text)) {
      const result = await sendAndroidScript(deviceId, "instagram", { request: text });
      return { assistant: result?.message || (isInstagramLikeCommand(text) ? "Liked the current reel." : "Instagram Reels opened."), executed: result?.ok !== false, tool: "android.script", scriptName: "instagram", intentVersion: ANDROID_INTENTS_VERSION, result };
    }

    const navigation = directNavigationAction(text);
    if (navigation) {
      const result = await sendAndroidCommand(deviceId, navigation, {});
      return { assistant: result?.message || "Android navigation completed.", executed: result?.ok !== false, tool: "android.automation", intentVersion: ANDROID_INTENTS_VERSION, result };
    }

    const systemAction = directSystemAction(text);
    if (systemAction) {
      const result = await sendAndroidCommand(deviceId, systemAction.action, systemAction.args);
      return { assistant: result?.message || "Android system action completed.", executed: result?.ok !== false, tool: "android.system", intentVersion: ANDROID_INTENTS_VERSION, result };
    }

    if (!looksLikeAndroidCommand(text)) return null;

    const result = await sendAndroidCommand(deviceId, "execute_command", { command: text });
    if (result?.ok === false) {
      return { assistant: result?.message || result?.error || "I couldn't complete that Android command.", executed: false, tool: "android.automation", intentVersion: ANDROID_INTENTS_VERSION, result };
    }

    return { assistant: result?.message || "Done, Mama.", executed: true, tool: "android.automation", intentVersion: ANDROID_INTENTS_VERSION, result };
  } catch (error) {
    return {
      assistant: `I couldn't complete that Android action: ${error instanceof Error ? error.message : String(error)}`,
      executed: false,
      tool: "android.automation",
      intentVersion: ANDROID_INTENTS_VERSION
    };
  }
}
