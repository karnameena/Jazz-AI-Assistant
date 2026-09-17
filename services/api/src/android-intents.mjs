import { getDevice, sendAndroidCommand } from "./device-bridge.mjs";

const APP_PACKAGES = {
  instagram: "com.instagram.android",
  youtube: "com.google.android.youtube",
  whatsapp: "com.whatsapp",
  "youtube music": "com.google.android.apps.youtube.music"
};

function deviceFor(text) {
  return /\btablet\b/i.test(text) ? "android-tablet" : "android-phone";
}

async function run(deviceId, action, args, success) {
  const device = getDevice(deviceId);
  if (!device) return { assistant: `I don't know that device yet.` };
  try {
    const result = await sendAndroidCommand(deviceId, action, args);
    if (result?.ok === false) return { assistant: result.message || `I couldn't control ${device.name}.` };
    return { assistant: success(device), executed: true, tool: `android.${action}`, result };
  } catch (error) {
    return { assistant: `I couldn't control ${device.name}: ${error.message}` };
  }
}

export async function handleAndroidIntent(message) {
  const text = String(message || "").trim();
  if (!text) return null;
  const deviceId = deviceFor(text);

  const open = text.match(/\b(?:open|launch|start)\s+(instagram|youtube music|youtube|whatsapp)\b/i);
  if (open) {
    const app = open[1].toLowerCase();
    return run(deviceId, "launch_app", { packageName: APP_PACKAGES[app] }, device => `${open[1]} is opening on ${device.name}.`);
  }

  if (/\b(?:open|show|go to)\s+(?:instagram\s+)?reels?\b/i.test(text)) {
    const launched = await run(deviceId, "launch_app", { packageName: APP_PACKAGES.instagram }, device => `Instagram is open on ${device.name}.`);
    if (!launched.executed) return launched;
    await new Promise(resolve => setTimeout(resolve, 900));
    return run(deviceId, "click_text", { text: "Reels" }, device => `Reels is open on ${device.name}.`);
  }

  if (/\b(?:next reel|scroll down|scroll reels?|next video)\b/i.test(text)) {
    return run(deviceId, "scroll_down", {}, device => `Scrolled down on ${device.name}.`);
  }

  if (/\b(?:previous reel|scroll up|previous video)\b/i.test(text)) {
    return run(deviceId, "scroll_up", {}, device => `Scrolled up on ${device.name}.`);
  }

  if (/\b(?:go back|back)\b/i.test(text)) {
    return run(deviceId, "back", {}, device => `Went back on ${device.name}.`);
  }

  if (/\b(?:go home|home screen)\b/i.test(text)) {
    return run(deviceId, "home", {}, device => `Opened the home screen on ${device.name}.`);
  }

  if (/\b(?:read|what(?:'s| is) on) (?:the )?screen\b/i.test(text)) {
    return run(deviceId, "read_screen", {}, device => `I read the visible screen on ${device.name}.`);
  }

  return null;
}
