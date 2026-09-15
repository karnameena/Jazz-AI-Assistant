import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

const scriptRoot = resolve(process.env.JAZZ_SCRIPT_ROOT || "scripts/android");

// Explicit allow-list. Jazz never executes an arbitrary path supplied by the LLM/user.
export const scripts = {
  paymom: {
    file: "paymom.sh",
    description: "Run Mama's approved Mom payment preparation workflow",
    aliases: ["pay mom", "pay my mom", "pay mom something", "pay mom money"],
    requiresConfirmation: true,
    category: "financial"
  },
  unlock: {
    file: "unlock.sh",
    description: "Run Mama's approved device wake/unlock workflow",
    aliases: ["unlock my mobile", "unlock my phone", "unlock phone"],
    requiresConfirmation: true,
    category: "device"
  },
  instagram: {
    file: "insta.sh",
    description: "Run Mama's approved Instagram automation",
    aliases: ["run instagram automation", "instagram automation", "open instagram"],
    requiresConfirmation: false,
    category: "social"
  },
  youtube: {
    file: "youtube.sh",
    description: "Run Mama's approved YouTube automation",
    aliases: ["play youtube", "open youtube", "play tamil songs", "tamil songs on youtube"],
    requiresConfirmation: false,
    category: "media"
  },
  screenshot: {
    file: "screenshot.sh",
    description: "Run Mama's approved Android screenshot workflow",
    aliases: ["take a screenshot", "take screenshot", "screenshot my phone"],
    requiresConfirmation: false,
    category: "device"
  }
};

export function getScript(name) {
  return scripts[name] || null;
}

export function findScriptForMessage(message) {
  const lower = String(message || "").toLowerCase();
  return Object.entries(scripts).find(([, script]) =>
    script.aliases.some(alias => lower.includes(alias))
  ) || null;
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