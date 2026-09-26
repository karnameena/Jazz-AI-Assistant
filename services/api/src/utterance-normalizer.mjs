const COMMAND_WORDS = [
  "open", "launch", "start", "close", "scroll", "swipe", "search", "play",
  "tap", "click", "type", "read", "show", "check", "pay", "send", "unlock",
  "end", "cut", "disconnect", "hang", "put", "turn", "switch", "speaker", "speakerphone"
];

const COMMAND_ALIASES = new Map([
  ["opn", "open"], ["opan", "open"], ["openn", "open"],
  ["scrol", "scroll"],
  ["serch", "search"], ["seach", "search"], ["srch", "search"],
  ["ply", "play"], ["plaay", "play"],
  ["disconect", "disconnect"], ["disconnct", "disconnect"], ["discconnect", "disconnect"],
  ["speker", "speaker"], ["spaker", "speaker"], ["speeker", "speaker"], ["speakar", "speaker"]
]);

const APP_SLOT_WORDS = new Set(["open", "launch", "start", "in", "on", "using", "from"]);
const SENSITIVE_COMMAND_WORDS = new Set(["pay", "send", "unlock"]);
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
  const protect = match => {
    const key = `__JAZZ_PROTECTED_${protectedParts.length}__`;
    protectedParts.push(match);
    return key;
  };
  const value = text
    .replace(/(["'`])([^\n]*?)\1/g, protect)
    .replace(/https?:\/\/\S+|(?:[a-zA-Z]:\\|\/)[^\s]+/g, protect);
  return {
    value,
    restore: input => protectedParts.reduce(
      (output, part, index) => output.replace(`__JAZZ_PROTECTED_${index}__`, part),
      input
    )
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

function normalizeCommandWords(text, corrections) {
  const tokens = text.split(/(\s+)/);
  let commandSlot = true;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (/^\s+$/.test(token)) continue;
    const bare = token.replace(/[^a-z]/gi, "");
    if (!bare) continue;
    const lower = bare.toLowerCase();
    if (commandSlot && (lower === "hey" || lower === "jazz")) continue;
    if (lower === "and" || lower === "then") {
      commandSlot = true;
      continue;
    }
    if (!commandSlot) continue;
    const alias = COMMAND_ALIASES.get(lower);
    if (alias) {
      tokens[i] = token.replace(new RegExp(escapeRegex(bare), "i"), alias);
      corrections.push({ from: bare, to: alias, kind: "command-alias", penalty: 0.025 });
      commandSlot = false;
      continue;
    }
    if (COMMAND_WORDS.includes(lower)) {
      commandSlot = false;
      continue;
    }
    let best = null;
    for (const candidate of COMMAND_WORDS) {
      if (SENSITIVE_COMMAND_WORDS.has(candidate)) continue;
      const distance = levenshtein(lower, candidate);
      const allowed = Math.max(1, Math.floor(candidate.length / 4));
      if (distance <= allowed && (!best || distance < best.distance)) best = { candidate, distance };
    }
    if (best) {
      tokens[i] = token.replace(new RegExp(escapeRegex(bare), "i"), best.candidate);
      corrections.push({ from: bare, to: best.candidate, kind: "fuzzy-command", penalty: 0.08 + best.distance * 0.02 });
    }
    commandSlot = false;
  }
  return tokens.join("");
}

function normalizeConversationTypos(text, corrections) {
  if (/^(?:hey\s+jazz\s+|jazz\s+)?(?:open|launch|start|close|scroll|swipe|search|play|tap|click|type|message|send|end|cut|disconnect|hang|put|turn|switch|speaker|speakerphone)\b/i.test(text)) {
    return text;
  }
  let output = text;
  output = replaceTracked(output, /\bwhts\b/gi, "what's", corrections, "conversation", 0.025);
  output = replaceTracked(output, /\bwhatt\b/gi, "what", corrections, "conversation", 0.025);
  output = replaceTracked(output, /\bdoingf\b/gi, "doing", corrections, "conversation", 0.025);
  output = replaceTracked(output, /\bwhat\s+doing\b/gi, "what are you doing", corrections, "conversation", 0.02);
  output = replaceTracked(output, /\bwhat's\s+my\s+mobile\s+status\b/gi, "what is my mobile status", corrections, "conversation", 0.01);
  return output;
}

function normalizeCallEndPhrase(text, corrections) {
  const wake = text.match(/^\s*(?:hey\s+jazz\s+|jazz\s+)?/i)?.[0] || "";
  const body = text.slice(wake.length).trim();
  if (/^hang\s*up(?:\s+(?:the\s+)?(?:call|cal|coll))?[.!? ]*$/i.test(body)) {
    return replaceTracked(text, /hang\s*up(?:\s+(?:the\s+)?(?:call|cal|coll))?/i, "end the call", corrections, "call-end", 0.02);
  }
  const match = body.match(/^([a-z]+)\s+(?:the\s+)?([a-z]+)[.!? ]*$/i);
  if (!match) return text;
  const verb = match[1].toLowerCase();
  const noun = match[2].toLowerCase();
  const callLike = levenshtein(noun, "call") <= 1;
  if (!callLike) return text;
  const verbs = ["end", "cut", "close", "disconnect"];
  const matchedVerb = verbs.find(candidate => {
    const allowed = candidate === "disconnect" ? 2 : 1;
    return levenshtein(verb, candidate) <= allowed;
  });
  if (!matchedVerb) return text;
  const normalized = `${wake}end the call`.trim();
  if (normalizeSpaces(text).toLowerCase() !== normalized.toLowerCase()) {
    corrections.push({ from: body, to: "end the call", kind: "call-end", penalty: 0.035 });
  }
  return normalized;
}

function normalizeSpeakerPhrase(text, corrections) {
  const wake = text.match(/^\s*(?:hey\s+jazz\s+|jazz\s+)?/i)?.[0] || "";
  const body = text.slice(wake.length).trim();
  const match = body.match(/^(?:(put|turn|switch)\s+(?:the\s+)?)?([a-z]+)\s+(on|off)[.!? ]*$/i);
  if (!match) return text;
  const speakerWord = match[2].toLowerCase();
  if (levenshtein(speakerWord, "speaker") > 2 && levenshtein(speakerWord, "speakerphone") > 3) return text;
  const normalized = `${wake}speaker ${match[3].toLowerCase()}`.trim();
  if (normalizeSpaces(text).toLowerCase() !== normalized.toLowerCase()) {
    corrections.push({ from: body, to: `speaker ${match[3].toLowerCase()}`, kind: "speaker", penalty: 0.025 });
  }
  return normalized;
}

function normalizeCommandPhrases(text, corrections) {
  let output = text;
  output = replaceTracked(output, /\bscrollup\b/gi, "scroll up", corrections, "phrase", 0.01);
  output = replaceTracked(output, /\bscrolldown\b/gi, "scroll down", corrections, "phrase", 0.01);
  output = replaceTracked(output, /\b(scroll|swipe)\s+ap\b/gi, (_, verb) => `${verb} up`, corrections, "direction", 0.04);
  output = replaceTracked(output, /\b(scroll|swipe)\s+dwn\b/gi, (_, verb) => `${verb} down`, corrections, "direction", 0.04);
  output = normalizeCallEndPhrase(output, corrections);
  output = normalizeSpeakerPhrase(output, corrections);
  return output;
}

function normalizeApps(text, corrections) {
  let output = text;
  for (const app of APP_ALIASES) {
    for (const variant of [...app.variants].sort((a, b) => b.length - a.length)) {
      const escaped = escapeRegex(variant).replace(/\\ /g, "\\s+");
      const pattern = new RegExp(`\\b(open|launch|start|in|on|using|from)\\s+(${escaped})\\b`, "gi");
      output = replaceTracked(output, pattern, (_, prefix) => `${prefix} ${app.canonical}`, corrections, "app",
        variant.toLowerCase().replace(/\s+/g, "") === app.canonical.toLowerCase().replace(/\s+/g, "") ? 0 : 0.015);
    }
  }
  return output;
}

function fuzzyApps(text, corrections) {
  const tokens = text.split(/(\s+)/);
  let previousWord = "";
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (/^\s+$/.test(token)) continue;
    const bare = token.replace(/[^a-z]/gi, "");
    if (!bare) continue;
    const lower = bare.toLowerCase();
    const isAppSlot = APP_SLOT_WORDS.has(previousWord);
    if (isAppSlot && bare.length >= 4 && !/__JAZZ_PROTECTED_/i.test(token)) {
      let best = null;
      for (const app of APP_ALIASES) {
        const candidates = [app.canonical, ...app.variants].map(value => value.toLowerCase().replace(/\s+/g, "")).filter(value => value.length >= 4);
        for (const candidate of candidates) {
          const distance = levenshtein(lower, candidate);
          const allowed = candidate.length >= 8 ? 2 : 1;
          if (distance <= allowed && (!best || distance < best.distance)) best = { app, distance };
        }
      }
      if (best && lower !== best.app.canonical.toLowerCase()) {
        tokens[i] = token.replace(new RegExp(escapeRegex(bare), "i"), best.app.canonical);
        corrections.push({ from: bare, to: best.app.canonical, kind: "fuzzy-app", penalty: 0.07 + best.distance * 0.02 });
        previousWord = best.app.canonical.toLowerCase();
        continue;
      }
    }
    previousWord = lower;
  }
  return tokens.join("");
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
  if (/\bend\s+(?:the\s+)?call\b/i.test(text)) intents.push({ intent: "END_CALL", target: "Phone" });
  if (/\bspeaker\s+on\b/i.test(text)) intents.push({ intent: "SPEAKER_ON", target: "Phone" });
  if (/\bspeaker\s+off\b/i.test(text)) intents.push({ intent: "SPEAKER_OFF", target: "Phone" });
  if (/\b(?:what is|what's|check|show)\s+(?:my\s+)?mobile\s+status\b/i.test(text)) intents.push({ intent: "MOBILE_STATUS", target: "Mobile" });
  if (/^\s*(?:hey\s+jazz\s+|jazz\s+)?unlock(?:\s+(?:my\s+)?(?:mobile|phone))?(?:\s+jazz)?[!. ]*$/i.test(text)) intents.push({ intent: "UNLOCK_MOBILE", target: "Mobile", sensitive: true });
  if (/\b(?:pay|send)\b[^,;\n]{0,90}?\b(?:my\s+)?(?:mom|momma|mummy)\b/i.test(text)) intents.push({ intent: "PAY_MOM", target: "Mom", sensitive: true });
  if (/\bWhatsApp\b/i.test(text) && /\bsearch\b/i.test(text)) intents.push({ intent: "WHATSAPP_SEARCH", target: "WhatsApp" });
  if (/\bplay\b.+\bYouTube\b|\bYouTube\b.+\bplay\b/i.test(text)) intents.push({ intent: "PLAY_MEDIA", target: "YouTube" });
  if (!intents.length && /^\s*(?:hey\s+jazz\s+|jazz\s+)?search(?:\s+for)?\s+.+/i.test(text)) intents.push({ intent: "SEARCH_UI", target: null });
  return intents;
}

function actionableShape(text) {
  return /^(?:hey\s+jazz\s+|jazz\s+)?(?:open|launch|start|close|scroll|swipe|search|play|tap|click|type|read|show|check|unlock|pay|send|end|cut|disconnect|hang|put|turn|switch|speaker|speakerphone)\b/i.test(text);
}

function sensitiveNearMiss(text) {
  const stripped = text.replace(/^\s*(?:hey\s+jazz\s+|jazz\s+)/i, "").trim();
  const match = stripped.match(/^([a-z]+)\b/i);
  if (!match) return null;
  const verb = match[1].toLowerCase();
  if (/\b(?:mobile|phone)\b/i.test(stripped) && verb !== "unlock" && levenshtein(verb, "unlock") === 1) {
    return stripped.replace(/^([a-z]+)/i, "unlock");
  }
  if (/\b(?:mom|momma|mummy)\b/i.test(stripped) && verb !== "pay" && levenshtein(verb, "pay") === 1) {
    return stripped.replace(/^([a-z]+)/i, "pay");
  }
  return null;
}

export function normalizeUtterance(raw, options = {}) {
  const original = normalizeSpaces(raw);
  const source = options.source === "voice" ? "voice" : "typed";
  const corrections = [];
  if (!original) {
    return { raw: original, normalized: original, source, changed: false, corrections, intents: [], intent: null,
      target: null, confidence: 1, confidenceLevel: "HIGH", requiresClarification: false, suggestion: null };
  }
  const protectedText = protectArbitraryData(original);
  let text = protectedText.value;
  text = normalizeWake(text, corrections);
  text = normalizeCommandWords(text, corrections);
  text = normalizeCommandPhrases(text, corrections);
  text = normalizeApps(text, corrections);
  text = fuzzyApps(text, corrections);
  text = normalizeConversationTypos(text, corrections);
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
  let suggestion = null;
  const nearSensitive = !sensitive ? sensitiveNearMiss(text) : null;
  if (nearSensitive) {
    confidence = Math.min(confidence, 0.55);
    confidenceLevel = "LOW";
    requiresClarification = true;
    suggestion = `Did you mean: ${nearSensitive}?`;
  } else if (sensitive && fuzzyCount > 0) {
    confidence = Math.min(confidence, 0.64);
    confidenceLevel = "LOW";
    requiresClarification = true;
  } else if (confidenceLevel === "LOW" && actionableShape(text)) {
    requiresClarification = true;
  }
  const primary = intents[0] || null;
  if (!suggestion) {
    suggestion = requiresClarification && text && text !== original
      ? `Did you mean: ${text}?`
      : requiresClarification
        ? "I’m not confident enough to execute that command. Please rephrase it."
        : null;
  }
  return {
    raw: original, normalized: text, source, changed: text !== original, corrections, intents,
    intent: primary?.intent || null, target: primary?.target || null, confidence: Number(confidence.toFixed(2)),
    confidenceLevel, requiresClarification, suggestion, protectedInput: URL_OR_PATH.test(original)
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
