const COMMAND_WORDS = [
  "open", "launch", "start", "close", "scroll", "swipe", "search", "play",
  "tap", "click", "type", "read", "show", "check"
];

const SENSITIVE_EXACT = /\b(?:pay|send\s+money|unlock)\b/i;
const URL_OR_PATH = /(?:https?:\/\/\S+|(?:[a-z]:\\|\/)[^\s]+|\b[\w.-]+\.(?:com|in|org|net|io)\b)/i;

const APP_ALIASES = [
  { canonical: "Instagram", variants: ["instagram", "insta", "instgram", "instagramm", "instragram"] },
  { canonical: "YouTube", variants: ["youtube", "yt", "youtub", "yutube", "you tube"] },
  { canonical: "WhatsApp", variants: ["whatsapp", "whats app", "whatsap", "watsapp", "whatapp", "whatsup"] },
  { canonical: "Swiggy", variants: ["swiggy", "swigy", "swiggi"] },
  { canonical: "Zomato", variants: ["zomato", "zomoto", "zomto"] },
  { canonical: "BookMyShow", variants: ["bookmyshow", "book my show", "bookmy show", "book myshow"] }
];

const DIRECT_REPLACEMENTS = [
  [/\bopn\b/gi, "open"],
  [/\bopan\b/gi, "open"],
  [/\bopenn\b/gi, "open"],
  [/\bscrol\b/gi, "scroll"],
  [/\bserch\b/gi, "search"],
  [/\bseach\b/gi, "search"],
  [/\bsrch\b/gi, "search"],
  [/\bply\b/gi, "play"],
  [/\bplaay\b/gi, "play"],
  [/\bwhts\b/gi, "what's"],
  [/\bwhatt\b/gi, "what"],
  [/\bdoingf\b/gi, "doing"]
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function levenshtein(a, b) {
  const left = String(a || "").toLowerCase();
  const right = String(b || "").toLowerCase();
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  const current = new Array(right.length + 1);
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j];
  }
  return previous[right.length];
}

function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function protectArbitraryData(text) {
  const protectedParts = [];
  const value = text.replace(/(["'`])([^\n]*?)\1/g, match => {
    const key = `__JAZZ_PROTECTED_${protectedParts.length}__`;
    protectedParts.push(match);
    return key;
  }).replace(/https?:\/\/\S+|(?:[a-zA-Z]:\\|\/)[^\s]+/g, match => {
    const key = `__JAZZ_PROTECTED_${protectedParts.length}__`;
    protectedParts.push(match);
    return key;
  });
  return {
    value,
    restore: input => protectedParts.reduce((output, part, index) => output.replace(`__JAZZ_PROTECTED_${index}__`, part), input)
  };
}

function replaceTracked(text, pattern, replacement, corrections, kind = "alias", penalty = 0.02) {
  return text.replace(pattern, (...args) => {
    const original = args[0];
    const next = typeof replacement === "function" ? replacement(...args) : replacement;
    if (String(original) !== String(next)) corrections.push({ from: original, to: next, kind, penalty });
    return next;
  });
}

function normalizeWake(text, corrections) {
  const match = text.match(/^\s*(hey\s+)?(jas|jaz|jass|jazz)\b[,:;.!-]?\s*/i);
  if (!match) return text;
  const replacement = match[1] ? "hey jazz " : "jazz ";
  if (match[0].trim().toLowerCase() !== replacement.trim()) {
    corrections.push({ from: match[0].trim(), to: replacement.trim(), kind: "wake", penalty: 0.01 });
  }
  return replacement + text.slice(match[0].length);
}

function commandContext(text) {
  return /\b(?:open|launch|start|close|scroll|swipe|search|play|message|text|send|show|check|status)\b/i.test(text);
}

function normalizeApps(text, corrections) {
  if (!commandContext(text)) return text;
  let output = text;
  for (const app of APP_ALIASES) {
    for (const variant of [...app.variants].sort((a, b) => b.length - a.length)) {
      const pattern = new RegExp(`\\b${escapeRegex(variant).replace(/\\ /g, "\\s+")}\\b`, "gi");
      output = replaceTracked(output, pattern, app.canonical, corrections, "app", variant.toLowerCase() === app.canonical.toLowerCase() ? 0 : 0.015);
    }
  }
  return output;
}

function fuzzyApps(text, corrections) {
  if (!commandContext(text)) return text;
  const tokens = text.split(/(\s+)/);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (/^\s+$/.test(token) || /__JAZZ_PROTECTED_/i.test(token)) continue;
    const bare = token.replace(/[^a-z]/gi, "");
    if (bare.length < 4) continue;
    const lower = bare.toLowerCase();
    let best = null;
    for (const app of APP_ALIASES) {
      const candidates = [app.canonical, ...app.variants]
        .map(value => value.toLowerCase().replace(/\s+/g, ""))
        .filter(value => value.length >= 4);
      for (const candidate of candidates) {
        const distance = levenshtein(lower, candidate);
        const allowed = candidate.length >= 8 ? 2 : 1;
        if (distance <= allowed && (!best || distance < best.distance)) best = { app, distance };
      }
    }
    if (best && lower !== best.app.canonical.toLowerCase()) {
      tokens[i] = token.replace(new RegExp(escapeRegex(bare), "i"), best.app.canonical);
      corrections.push({ from: bare, to: best.app.canonical, kind: "fuzzy-app", penalty: 0.07 + best.distance * 0.02 });
    }
  }
  return tokens.join("");
}

function fuzzyCommandWords(text, corrections) {
  const tokens = text.split(/(\s+)/);
  let afterConjunction = true;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (/^\s+$/.test(token)) continue;
    const bare = token.replace(/[^a-z]/gi, "");
    if (!bare) continue;
    const lower = bare.toLowerCase();

    // Wake words are context, not the command verb. Keep looking for the first
    // actionable word after "hey jazz".
    if (afterConjunction && (lower === "hey" || lower === "jazz")) continue;
    if (lower === "and" || lower === "then") {
      afterConjunction = true;
      continue;
    }
    if (!afterConjunction) continue;
    if (COMMAND_WORDS.includes(lower)) {
      afterConjunction = false;
      continue;
    }

    let best = null;
    for (const candidate of COMMAND_WORDS) {
      const distance = levenshtein(lower, candidate);
      const allowed = Math.max(1, Math.floor(candidate.length / 4));
      if (distance <= allowed && (!best || distance < best.distance)) best = { candidate, distance };
    }
    if (best) {
      tokens[i] = token.replace(new RegExp(escapeRegex(bare), "i"), best.candidate);
      corrections.push({ from: bare, to: best.candidate, kind: "fuzzy-command", penalty: 0.08 + best.distance * 0.02 });
    }
    afterConjunction = false;
  }
  return tokens.join("");
}

function normalizeCommandPhrases(text, corrections) {
  let output = text;
  output = replaceTracked(output, /\bscrollup\b/gi, "scroll up", corrections, "phrase", 0.01);
  output = replaceTracked(output, /\bscrolldown\b/gi, "scroll down", corrections, "phrase", 0.01);
  output = replaceTracked(output, /\b(scroll|swipe)\s+ap\b/gi, (_, verb) => `${verb} up`, corrections, "direction", 0.04);
  output = replaceTracked(output, /\b(scroll|swipe)\s+dwn\b/gi, (_, verb) => `${verb} down`, corrections, "direction", 0.04);
  output = replaceTracked(output, /\bwhat\s+doing\b/gi, "what are you doing", corrections, "conversation", 0.02);
  output = replaceTracked(output, /\bwhat's\s+my\s+mobile\s+status\b/gi, "what is my mobile status", corrections, "phrase", 0.01);
  return output;
}

function canonicalApp(value) {
  const lower = String(value || "").toLowerCase().replace(/\s+/g, "");
  return APP_ALIASES.find(app => app.canonical.toLowerCase().replace(/\s+/g, "") === lower)?.canonical || value;
}

function detectIntents(text) {
  const intents = [];
  const appMatch = text.match(/\b(?:open|launch|start)\s+(Instagram|YouTube|WhatsApp|Swiggy|Zomato|BookMyShow)\b/i);
  if (appMatch) intents.push({ intent: "OPEN_APP", target: canonicalApp(appMatch[1]) });
  if (/\b(?:scroll|swipe)\s+up\b/i.test(text)) intents.push({ intent: "SCROLL_UP", target: null });
  if (/\b(?:scroll|swipe)\s+down\b/i.test(text)) intents.push({ intent: "SCROLL_DOWN", target: null });
  if (/\b(?:what is|what's|check|show)\s+(?:my\s+)?mobile\s+status\b/i.test(text)) intents.push({ intent: "MOBILE_STATUS", target: "Mobile" });
  if (/^\s*(?:hey\s+jazz\s+|jazz\s+)?unlock(?:\s+(?:my\s+)?(?:mobile|phone))?(?:\s+jazz)?[!. ]*$/i.test(text)) intents.push({ intent: "UNLOCK_MOBILE", target: "Mobile", sensitive: true });
  if (/\b(?:pay|send)\b[^,;\n]{0,90}?\b(?:my\s+)?(?:mom|momma|mummy)\b/i.test(text)) intents.push({ intent: "PAY_MOM", target: "Mom", sensitive: true });
  if (/\bWhatsApp\b/i.test(text) && /\bsearch\b/i.test(text)) intents.push({ intent: "WHATSAPP_SEARCH", target: "WhatsApp" });
  if (/\bplay\b.+\bYouTube\b|\bYouTube\b.+\bplay\b/i.test(text)) intents.push({ intent: "PLAY_MEDIA", target: "YouTube" });
  if (!intents.length && /^\s*(?:hey\s+jazz\s+|jazz\s+)?search(?:\s+for)?\s+.+/i.test(text)) intents.push({ intent: "SEARCH_UI", target: null });
  return intents;
}

function actionableShape(text) {
  return /^(?:hey\s+jazz\s+|jazz\s+)?(?:open|launch|start|close|scroll|swipe|search|play|tap|click|type|read|show|check|unlock|pay|send)\b/i.test(text);
}

export function normalizeUtterance(raw, options = {}) {
  const original = normalizeSpaces(raw);
  const source = options.source === "voice" ? "voice" : "typed";
  const corrections = [];
  if (!original) {
    return {
      raw: original, normalized: original, source, changed: false, corrections, intents: [], intent: null,
      target: null, confidence: 1, confidenceLevel: "HIGH", requiresClarification: false, suggestion: null
    };
  }

  const protectedText = protectArbitraryData(original);
  let text = protectedText.value;
  text = normalizeWake(text, corrections);
  for (const [pattern, replacement] of DIRECT_REPLACEMENTS) {
    text = replaceTracked(text, pattern, replacement, corrections, "alias", 0.025);
  }
  text = normalizeCommandPhrases(text, corrections);
  text = fuzzyCommandWords(text, corrections);
  text = normalizeApps(text, corrections);
  text = fuzzyApps(text, corrections);
  text = normalizeSpaces(protectedText.restore(text));

  const intents = detectIntents(text);
  const sensitive = intents.some(item => item.sensitive) || SENSITIVE_EXACT.test(text);
  const fuzzyCount = corrections.filter(item => item.kind.startsWith("fuzzy")).length;
  const totalPenalty = corrections.reduce((sum, item) => sum + Number(item.penalty || 0), 0);
  let confidence = Math.max(0.45, Math.min(1, 0.99 - totalPenalty));
  if (actionableShape(text) && intents.length === 0) confidence -= 0.1;
  if (source === "voice" && corrections.length >= 4) confidence -= 0.05;
  confidence = Math.max(0, Math.min(1, confidence));

  let confidenceLevel = confidence >= 0.88 ? "HIGH" : confidence >= 0.68 ? "MEDIUM" : "LOW";
  let requiresClarification = false;
  if (sensitive && fuzzyCount > 0) {
    confidence = Math.min(confidence, 0.64);
    confidenceLevel = "LOW";
    requiresClarification = true;
  } else if (confidenceLevel === "LOW" && actionableShape(text)) {
    requiresClarification = true;
  }

  const primary = intents[0] || null;
  const suggestion = requiresClarification && text && text !== original
    ? `Did you mean: ${text}?`
    : requiresClarification
      ? "I’m not confident enough to execute that command. Please rephrase it."
      : null;

  return {
    raw: original,
    normalized: text,
    source,
    changed: text !== original,
    corrections,
    intents,
    intent: primary?.intent || null,
    target: primary?.target || null,
    confidence: Number(confidence.toFixed(2)),
    confidenceLevel,
    requiresClarification,
    suggestion,
    protectedInput: URL_OR_PATH.test(original)
  };
}

export function debugUnderstanding(result, env = process.env) {
  const enabled = env.JAZZ_DEBUG_UNDERSTANDING === "true" || env.NODE_ENV !== "production";
  if (!enabled || !result) return;
  console.log(`[STT RAW] ${result.raw}`);
  console.log(`[NORMALIZED] ${result.normalized}`);
  console.log(`[INTENT] ${result.intents?.map(item => item.intent).join(" -> ") || "CONVERSATION"}`);
  console.log(`[TARGET] ${result.intents?.map(item => item.target).filter(Boolean).join(" -> ") || "none"}`);
  console.log(`[CONFIDENCE] ${result.confidence}`);
}
