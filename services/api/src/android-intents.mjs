import { getDevice, sendAndroidCommand } from "./device-bridge.mjs";

const APP_PACKAGES = {
  instagram: "com.instagram.android",
  youtube: "com.google.android.youtube",
  whatsapp: "com.whatsapp",
  "youtube music": "com.google.android.apps.youtube.music"
};

export const ANDROID_INTENTS_VERSION = "youtube-search-v2";

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

function cleanYouTubeQuery(raw) {
  return String(raw || "")
    .replace(/^youtube(?:\s+music)?\s+(?:for\s+)?/i, "")
    .replace(/\s+(?:on|in)\s+youtube(?:\s+music)?\s*$/i, "")
    .replace(/\s+(?:on|in)\s+(?:my\s+)?(?:mobile|phone|tablet)\s*$/i, "")
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
    waitAfter: 1500
  };
}

function youtubeSearchSteps(text) {
  // These are deterministic device commands and MUST NOT fall through to Ollama:
  //   search AR Rahman song
  //   search for AR Rahman songs
  //   search tamil songs in youtube
  //   search youtube for AR Rahman songs
  //   youtube search AR Rahman songs
  const patterns = [
    /\byoutube\s+search(?:\s+for)?\s+(.+)$/i,
    /\bsearch\s+youtube\s+for\s+(.+)$/i,
    /\bsearch(?:\s+for)?\s+(.+)$/i
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
    { ...searchStep, waitAfter: 3200 },
    {
      index: (match.index ?? 0) + match[0].length + 0.01,
      length: 0,
      action: "click_text",
      args: { text: query },
      label: `selected the first matching result for \"${query}\"`,
      waitAfter: 600
    }
  ];
}

function planAndroidSteps(text) {
  const steps = [];

  // Search commands always go to YouTube control before general AI chat.
  const searchSteps = youtubeSearchSteps(text);
  if (searchSteps.length) return searchSteps;

  // Music/video play requests use the installed Android companion instead of a
  // local youtube.ps1 file. Jazz opens YouTube search and selects a visible result.
  const playSteps = youtubePlaySteps(text);
  if (playSteps.length) return playSteps;

  const reelsSteps = collectMatches(
    text,
    /\b(?:open|show|go\s+to|launch|start)\s+(?:instagram\s+)?reels?\b/i,
    () => ({ action: "open_instagram_reels", args: {}, label: "opened Instagram Reels", waitAfter: 2600 })
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
    intentVersion: ANDROID_INTENTS_VERSION,
    steps: results
  };
}
