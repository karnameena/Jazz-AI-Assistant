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

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function collectMatches(text, regex, makeStep) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const global = new RegExp(regex.source, flags);
  return [...text.matchAll(global)].map(match => ({ index: match.index ?? 0, length: match[0].length, ...makeStep(match) }));
}

function overlaps(a, b) {
  return a.index < b.index + b.length && b.index < a.index + a.length;
}

function planAndroidSteps(text) {
  const steps = [];

  const reelsSteps = collectMatches(
    text,
    /\b(?:open|show|go\s+to|launch|start)\s+(?:instagram\s+)?reels?\b/i,
    () => ({ action: "open_instagram_reels", args: {}, label: "opened Instagram Reels", waitAfter: 2600 })
  );
  steps.push(...reelsSteps);

  const appSteps = collectMatches(
    text,
    /\b(?:open|launch|start)\s+(instagram|youtube music|youtube|whatsapp)\b/i,
    match => {
      const appName = String(match[1]).toLowerCase();
      return {
        action: "launch_app",
        args: { packageName: APP_PACKAGES[appName] },
        label: `opened ${match[1]}`,
        // Instagram can report that launch was requested before its window is actually
        // focused. Wait long enough before the next gesture so a swipe is not sent to
        // the previous app/home screen.
        waitAfter: appName === "instagram" ? 3000 : 1000
      };
    }
  ).filter(step => !reelsSteps.some(reel => overlaps(step, reel)));
  steps.push(...appSteps);

  // Mama uses "scroll up" to mean the finger/gesture moves upward on the screen.
  // In Android content terms that is scroll_down: finger bottom -> top.
  steps.push(...collectMatches(text, /\b(?:next\s+reel|next\s+video|scroll\s+up|swipe\s+up)\b/i,
    () => ({ action: "scroll_down", args: {}, label: "swiped up", waitAfter: 450 })));
  steps.push(...collectMatches(text, /\b(?:previous\s+reel|previous\s+video|scroll\s+down|swipe\s+down)\b/i,
    () => ({ action: "scroll_up", args: {}, label: "swiped down", waitAfter: 450 })));
  steps.push(...collectMatches(text, /\b(?:go\s+back|back)\b/i,
    () => ({ action: "back", args: {}, label: "went back", waitAfter: 220 })));
  steps.push(...collectMatches(text, /\b(?:go\s+home|home\s+screen|home)\b/i,
    () => ({ action: "home", args: {}, label: "opened Home", waitAfter: 220 })));
  steps.push(...collectMatches(text, /\b(?:read|what(?:'s|\s+is)\s+on)\s+(?:the\s+)?screen\b/i,
    () => ({ action: "read_screen", args: {}, label: "read the screen", waitAfter: 0 })));

  return steps.sort((a, b) => a.index - b.index);
}

export async function handleAndroidIntent(message) {
  const text = String(message || "").trim();
  if (!text) return null;

  const steps = planAndroidSteps(text);
  if (!steps.length) return null;

  const deviceId = deviceFor(text);
  const device = getDevice(deviceId);
  if (!device) return { assistant: "I don't know that Android device yet." };

  const results = [];
  for (const step of steps) {
    try {
      const result = await sendAndroidCommand(deviceId, step.action, step.args);
      results.push({ action: step.action, ok: result?.ok !== false, result });
      if (result?.ok === false) {
        return {
          assistant: result.message || `I couldn't ${step.label} on ${device.name}.`,
          executed: results.some(item => item.ok),
          steps: results
        };
      }
      if (step.waitAfter) await wait(step.waitAfter);
    } catch (error) {
      return {
        assistant: `I couldn't control ${device.name}: ${error instanceof Error ? error.message : String(error)}`,
        executed: results.some(item => item.ok),
        steps: results
      };
    }
  }

  return {
    assistant: `Done, Mama — ${steps.map(step => step.label).join(", then ")} on ${device.name}.`,
    executed: true,
    tool: "android.sequence",
    steps: results
  };
}
