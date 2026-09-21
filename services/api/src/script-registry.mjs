import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

const scriptRoot = resolve(process.env.JAZZ_SCRIPT_ROOT || "scripts/android");

// Explicit allow-list. Natural-language routing may select only these registered
// workflows. Internal filenames stay separate from user-facing names so Jazz does
// not expose implementation details in normal conversation.
export const scripts = {
  unlockmobile: {
    file: "mobile unlock",
    files: ["unlockmobile.ps1"],
    description: "Run Mama's approved mobile unlock workflow",
    aliases: ["unlock mobile", "unlock mobile jazz", "unlock my mobile", "unlock my phone", "unlock phone"],
    requiresConfirmation: false,
    category: "device",
    workflow: "script"
  },
  paymom: {
    file: "Mom payment",
    files: ["pay-mom.ps1", "Payto_Mom.ps1", "paymom.ps1", "paymom.sh"],
    description: "Mama-owned payment workflow",
    aliases: [
      "pay mom", "pay momma", "pay mummy", "pay my mom", "pay my momma", "pay my mummy",
      "pay to mom", "pay to momma", "pay to mummy", "pay to my mom", "pay to my momma", "pay to my mummy",
      "send money to mom", "send money to momma", "send money to mummy",
      "send money to my mom", "send money to my momma", "send money to my mummy"
    ],
    requiresConfirmation: false,
    category: "financial",
    workflow: "script"
  },
  instagram: {
    file: "Instagram automation",
    files: ["instagram.ps1", "instagram.sh", "insta.sh"],
    description: "Optional legacy Instagram script; normal Instagram commands use Android companion",
    aliases: ["run instagram script", "run legacy instagram script"],
    requiresConfirmation: false,
    category: "social",
    workflow: "script"
  },
  youtube: {
    file: "YouTube automation",
    files: ["youtube.ps1", "youtube.sh"],
    description: "Run Mama's approved YouTube search-and-play workflow",
    aliases: [
      "run youtube automation", "run youtube script",
      "play youtube", "play tamil songs", "tamil songs on youtube"
    ],
    requiresConfirmation: false,
    category: "media",
    workflow: "script"
  },
  screenshot: {
    file: "phone screenshot",
    files: ["screenshot.ps1", "screenshot.sh"],
    description: "Run Mama's approved Android screenshot workflow",
    aliases: ["take a screenshot", "take screenshot", "screenshot my phone"],
    requiresConfirmation: false,
    category: "device",
    workflow: "script"
  }
};

export function getScript(name) { return scripts[name] || null; }

export function findScriptForMessage(message) {
  const lower = String(message || "").toLowerCase().replace(/\s+/g, " ").trim();

  if (/\bunlock\b[^\n]{0,40}\b(?:mobile|phone)\b/i.test(lower)) {
    return ["unlockmobile", scripts.unlockmobile];
  }

  // Match natural variants such as:
  // "pay mom 1 rupee", "pay 1 rupee to mom", "pay momma", "pay to my mummy".
  if (/\b(?:pay|send)\b[^\n]{0,100}\b(?:my\s+)?(?:mom|momma|mummy)\b/i.test(lower)) {
    return ["paymom", scripts.paymom];
  }

  // YouTube play requests must execute youtube.ps1, not fall through to Ollama or
  // the generic Android companion sequence. Examples:
  // "open YouTube and play Vaathi Coming" and "play Vaathi Coming on YouTube".
  if (
    /\byoutube\b[^\n]{0,100}\bplay\b\s+.+$/i.test(lower) ||
    /\bplay\b\s+.+?\s+\b(?:on|in)\s+youtube\b/i.test(lower)
  ) {
    return ["youtube", scripts.youtube];
  }

  return Object.entries(scripts).find(([, script]) =>
    script.aliases.some(alias => lower.includes(alias))
  ) || null;
}

function candidateFiles(script) {
  return Array.isArray(script.files) && script.files.length ? script.files : [script.file];
}

export function scriptPath(name) {
  const script = getScript(name);
  if (!script) return null;
  const rootPrefix = `${scriptRoot}${process.platform === "win32" ? "\\" : "/"}`;

  for (const candidate of candidateFiles(script)) {
    const file = basename(candidate);
    const path = resolve(scriptRoot, file);
    if (!path.startsWith(rootPrefix)) continue;
    if (existsSync(path)) return path;
  }

  return null;
}

export function listScripts() {
  return Object.entries(scripts).map(([name, script]) => ({
    name,
    file: script.file,
    candidateFiles: candidateFiles(script),
    description: script.description,
    requiresConfirmation: script.requiresConfirmation,
    category: script.category,
    workflow: script.workflow || "script",
    installed: Boolean(scriptPath(name))
  }));
}