import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

const scriptRoot = resolve(process.env.JAZZ_SCRIPT_ROOT || "scripts/android");

export const scripts = {
  unlockmobile: {
    file: "unlockmobile.ps1",
    description: "Run Mama's approved Android wake/unlock workflow",
    aliases: [
      "unlock mobile", "unlock my mobile", "unlock the mobile",
      "unlock phone", "unlock my phone", "unlock the phone",
      "open mobile", "open my mobile", "open the mobile",
      "open phone", "open my phone", "open the phone",
      "wake mobile", "wake my mobile", "wake phone", "wake my phone",
      "open my mobile jazz", "unlock my mobile jazz",
      "jazz open my mobile", "jazz unlock my mobile"
    ],
    requiresConfirmation: true,
    category: "device"
  },
  paymom: {
    file: "pay-mom.ps1",
    description: "Open Mama's approved Mom payment navigation workflow",
    aliases: [
      "pay mom", "pay my mom", "pay to mom", "pay to my mom",
      "pay mummy", "pay my mummy", "pay to mummy", "pay to my mummy",
      "pay mommy", "pay my mommy", "pay to mommy", "pay to my mommy",
      "pay meena", "pay to meena", "pay to meena my mother",
      "pay my mother", "pay to my mother",
      "send money to mom", "send money to my mom",
      "send money to mummy", "send money to my mummy",
      "send money to mommy", "send money to my mommy",
      "send money to meena", "send money to my mother",
      "enga amma", "enga ammaku", "enga amma ku",
      "amma ku pay", "ammaku pay", "amma pay",
      "amma ku money send", "ammaku money send", "amma ku kasu anupu",
      "jazz pay mom", "jazz pay my mom", "jazz pay meena"
    ],
    requiresConfirmation: true,
    category: "financial"
  },
  instagram: {
    file: "instagram.ps1",
    description: "Run Mama's approved Instagram automation",
    aliases: ["run instagram automation", "instagram automation", "open instagram"],
    requiresConfirmation: false,
    category: "social"
  },
  youtube: {
    file: "youtube.ps1",
    description: "Run Mama's approved YouTube automation",
    aliases: ["play youtube", "open youtube", "play tamil songs", "tamil songs on youtube"],
    requiresConfirmation: false,
    category: "media"
  },
  screenshot: {
    file: "screenshot.ps1",
    description: "Run Mama's approved Android screenshot workflow",
    aliases: ["take a screenshot", "take screenshot", "screenshot my phone"],
    requiresConfirmation: false,
    category: "device"
  }
};

export function getScript(name) { return scripts[name] || null; }

function normalizeIntentText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMomPaymentIntent(normalized) {
  const words = new Set(normalized.split(" ").filter(Boolean));
  const hasRecipient = ["mom", "mummy", "mommy", "mother", "meena", "amma", "ammaku"].some(word => words.has(word));
  const hasPaymentVerb = ["pay", "send", "transfer"].some(word => words.has(word));
  const hasMoneyContext = /\b(?:ru+p(?:e+|ee+|eee+)?s?|rs|inr|money)\b/.test(normalized) || /\b\d+(?:\.\d+)?\b/.test(normalized);
  return hasRecipient && hasPaymentVerb && (hasMoneyContext || normalized.split(" ").length <= 6);
}

export function findScriptForMessage(message) {
  const normalized = normalizeIntentText(message);
  if (!normalized) return null;

  // Recognize flexible word order before falling back to exact aliases.
  // Examples: "pay 1 rupee to mom", "send 100 to mummy", "transfer rs 50 to my mother".
  if (isMomPaymentIntent(normalized)) return ["paymom", scripts.paymom];

  const candidates = [];
  for (const entry of Object.entries(scripts)) {
    const [, script] = entry;
    for (const alias of script.aliases) {
      const normalizedAlias = normalizeIntentText(alias);
      if (normalizedAlias && normalized.includes(normalizedAlias)) candidates.push({ entry, length: normalizedAlias.length });
    }
  }
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0]?.entry || null;
}

export function scriptPath(name) {
  const script = getScript(name);
  if (!script) return null;
  const file = basename(script.file);
  const path = resolve(scriptRoot, file);
  const rootPrefix = `${scriptRoot}${process.platform === "win32" ? "\\" : "/"}`;
  if (!path.startsWith(rootPrefix)) return null;
  return existsSync(path) ? path : null;
}

export function listScripts() {
  return Object.entries(scripts).map(([name, script]) => ({
    name,
    file: script.file,
    description: script.description,
    requiresConfirmation: script.requiresConfirmation,
    category: script.category,
    installed: Boolean(scriptPath(name))
  }));
}
