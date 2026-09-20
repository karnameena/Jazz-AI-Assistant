import { getDevice, sendAndroidCommand, sendAndroidScript } from "./device-bridge.mjs";

const APP_PACKAGES = {
  instagram: "com.instagram.android",
  youtube: "com.google.android.youtube",
  whatsapp: "com.whatsapp",
  "youtube music": "com.google.android.apps.youtube.music"
};

export const ANDROID_INTENTS_VERSION = "compound-sequence-v6";

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

function canonicalAppName(raw) {
  const value = String(raw || "").toLowerCase().trim();
  const compact = value.replace(/[\s'’-]+/g, "");
  if (compact === "whatsapp") return "whatsapp";
  if (value === "youtube music") return "youtube music";
  return value;
}

function extractAmount(text) {
  const value = String(text || "");
  const match =
    value.match(/(?:₹|rs\.?|inr\s*)\s*(\d+(?:\.\d+)?)/i) ||
    value.match(/\b(\d+(?:\.\d+)?)\s*(?:rupees?|rs)\b/i);
  return match ? Number(match[1]) : null;
}

function cleanYouTubeQuery(raw) {
  return String(raw || "")
    .replace(/^youtube(?:\s+music)?\s+(?:for\s+)?/i, "")
    .replace(/\s+(?:on|in)\s+youtube(?:\s+music)?\s*$/i, "")
    .replace(/\s+(?:on|in)\s+(?:my\s+)?(?:mobile|phone|tablet)\s*$/i, "")
    .replace(/\s+(?:please|jazz)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function youtubeSearchStep(query, index, length) {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  return {
    index,
    length,
    action: "open_url",
    args: { url: searchUrl },
    label: `searched YouTube for \"${query}\"`,
    waitAfter: 1800
  };
}

function youtubeSearchSteps(text) {
  const patterns = [
    /\byoutube\s+search(?:\s+for)?\s+(.+)$/i,
    /\bsearch\s+youtube\s+for\s+(.+)$/i,
    /\b(?:search|find|look\s+for)(?:\s+for)?\s+(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const query = cleanYouTubeQuery(match[1]);
    if (!query || /^(?:youtube|youtube music)$/i.test(query)) return [];
    return [youtubeSearchStep(query, match.index ?? 0, match[0].length)];
  }

  return [];
}

function youtubePlaySteps(text) {
  const match = text.match(/\bplay\s+(.+)$/i);
  if (!match) return [];

  const query = cleanYouTubeQuery(match[1]);
  if (!query || /^(?:youtube|youtube music)$/i.test(query)) return [];

  const searchStep = youtubeSearchStep(query, match.index ?? 0, match[0].length);
  return [
    { ...searchStep, waitAfter: 3400 },
    {
      index: (match.index ?? 0) + match[0].length + 0.01,
      length: 0,
      action: "click_text",
      args: { text: query },
      label: `selected the first matching result for \"${query}\"`,
      waitAfter: 700
    }
  ];
}

function planAndroidSteps(text) {
  const steps = [];

  // Registered scripts and normal Android actions share one ordered execution plan.
  // Example: "Hey Jazz unlock mobile and open Instagram scroll up" executes all 3.
  steps.push(...collectMatches(
    text,
    /\bunlock\s+(?:my\s+)?(?:mobile|phone)(?:\s+jazz)?\b/i,
    match => ({
      scriptName: "unlockmobile",
      args: { request: match[0] },
      label: "ran unlockmobile.ps1",
      waitAfter: 1200
    })
  ));

  steps.push(...collectMatches(
    text,
    /\b(?:pay|send)\b[^,;\n]{0,70}?\b(?:my\s+)?(?:mom|momma|mummy)\b(?:\s+(?:₹|rs\.?|inr)?\s*\d+(?:\.\d+)?\s*(?:rupees?|rs)?)?/i,
    match => {
      const amount = extractAmount(match[0]);
      return {
        scriptName: "paymom",
        args: { amount, request: match[0] },
        label: amount !== null ? `ran pay-mom.ps1 for ₹${amount}` : "ran pay-mom.ps1",
        waitAfter: 800
      };
    }
  ));

  steps.push(...collectMatches(
    text,
    /\b(?:take\s+(?:a\s+)?screenshot|screenshot\s+(?:my\s+)?phone)\b/i,
    match => ({
      scriptName: "screenshot",
      args: { request: match[0] },
      label: "ran screenshot script",
      waitAfter: 600
    })
  ));

  const searchSteps = youtubeSearchSteps(text);
  if (searchSteps.length && steps.length === 0) return searchSteps;

  const playSteps = youtubePlaySteps(text);
  if (playSteps.length && steps.length === 0) return playSteps;

  const reelsSteps = collectMatches(
    text,
    /\b(?:open|show|go\s+to|launch|start)\s+(?:instagram\s+)?reels?\b/i,
    () => ({ action: "open_instagram_reels", args: {}, label: "opened Instagram Reels", waitAfter: 4200 })
  );
  steps.push(...reelsSteps);

  const appSteps = collectMatches(
    text,
    /\b(?:open|launch|start)\s+(instagram|youtube music|youtube|whatsapp|whats\s*app|what['’]?s\s*app)\b/i,
    match => {
      const appName = canonicalAppName(match[1]);
      return {
        action: "launch_app",
        args: { packageName: APP_PACKAGES[appName] },
        label: `opened ${appName === "whatsapp" ? "WhatsApp" : match[1]}`,
        // Instagram often needs several seconds before it accepts a gesture after launch.
        waitAfter: appName === "instagram" ? 5500 : 1500
      };
    }
  ).filter(step => !reelsSteps.some(reel => overlaps(step, reel)));
  steps.push(...appSteps);

  // Mama uses "scroll up" to mean the finger moves upward: bottom -> top.
  steps.push(...collectMatches(text, /\b(?:next\s+reel|next\s+video|scroll\s+up|swipe\s+up)\b/i,
    () => ({ action: "scroll_down", args: {}, label: "swiped up", waitBefore: 500, waitAfter: 700 })));
  steps.push(...collectMatches(text, /\b(?:previous\s+reel|previous\s+video|scroll\s+down|swipe\s+down)\b/i,
    () => ({ action: "scroll_up", args: {}, label: "swiped down", waitBefore: 500, waitAfter: 700 })));
  steps.push(...collectMatches(text, /\b(?:go\s+back|back)\b/i,
    () => ({ action: "back", args: {}, label: "went back", waitAfter: 300 })));
  steps.push(...collectMatches(text, /\b(?:go\s+home|home\s+screen|home)\b/i,
    () => ({ action: "home", args: {}, label: "opened Home", waitAfter: 300 })));
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
      if (step.waitBefore) await wait(step.waitBefore);

      const result = step.scriptName
        ? await sendAndroidScript(deviceId, step.scriptName, step.args || {})
        : await sendAndroidCommand(deviceId, step.action, step.args || {});
      const actionName = step.scriptName ? `script:${step.scriptName}` : step.action;
      results.push({ action: actionName, label: step.label, ok: result?.ok !== false, result });

      if (result?.ok === false) {
        return {
          assistant: result.message || `I couldn't ${step.label} on ${device.name}.`,
          executed: results.some(item => item.ok),
          intentVersion: ANDROID_INTENTS_VERSION,
          steps: results
        };
      }
      if (step.waitAfter) await wait(step.waitAfter);
    } catch (error) {
      return {
        assistant: `I couldn't control ${device.name}: ${error instanceof Error ? error.message : String(error)}`,
        executed: results.some(item => item.ok),
        intentVersion: ANDROID_INTENTS_VERSION,
        steps: results
      };
    }
  }

  return {
    assistant: `Done, Mama — ${steps.map(step => step.label).join(", then ")} on ${device.name}.`,
    executed: true,
    tool: "android.sequence",
    intentVersion: ANDROID_INTENTS_VERSION,
    steps: results
  };
}
