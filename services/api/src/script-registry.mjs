import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

const scriptRoot = resolve(process.env.JAZZ_SCRIPT_ROOT || "scripts/android");

// Explicit allow-list. Jazz never executes an arbitrary path supplied by the LLM/user.
// Add future Mama-owned scripts here with an exact filename and aliases.
export const scripts = {
  unlockmobile: {
    file: "unlockmobile.ps1",
    description: "Run Mama's approved Android wake/unlock workflow",
    aliases: [
      "unlock mobile",
      "unlock my mobile",
      "unlock the mobile",
      "unlock phone",
      "unlock my phone",
      "unlock the phone",
      "open mobile",
      "open my mobile",
      "open the mobile",
      "open phone",
      "open my phone",
      "open the phone",
      "wake mobile",
      "wake my mobile",
      "wake phone",
      "wake my phone",
      "open my mobile jazz",
      "unlock my mobile jazz",
      "jazz open my mobile",
      "jazz unlock my mobile"
    ],
    requiresConfirmation: true,
    category: "device"
  },
  paymom: {
    file: "paymom.ps1",
    description: "Mama-owned payment workflow",
    aliases: ["pay mom", "pay my mom", "send money to mom", "send money to my mom"],
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

export function getScript(name) {
  return scripts[name] || null;
}

function normalizeIntentText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findScriptForMessage(message) {
  const normalized = normalizeIntentText(message);
  if (!normalized) return null;

  // Prefer the longest alias so specific phrases win over shorter overlaps.
  const candidates = [];
  for (const entry of Object.entries(scripts)) {
    const [, script] = entry;
    for (const alias of script.aliases) {
      const normalizedAlias = normalizeIntentText(alias);
      if (normalizedAlias && normalized.includes(normalizedAlias)) {
        candidates.push({ entry, length: normalizedAlias.length });
      }
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
