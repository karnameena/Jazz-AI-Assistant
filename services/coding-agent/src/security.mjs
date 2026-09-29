import path from "node:path";

const BLOCKED_BASENAMES = [
  ".env",
  ".env.local",
  "id_rsa",
  "id_ed25519",
  "credentials",
  "credentials.json",
  "secrets.json"
];

const BLOCKED_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".crt"]);

export function isSensitivePath(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/").toLowerCase();
  const base = path.basename(normalized);
  if (BLOCKED_BASENAMES.includes(base)) return true;
  if (base.startsWith(".env.")) return true;
  if (normalized.includes("/.ssh/") || normalized.endsWith("/.ssh")) return true;
  if (normalized.includes("/appdata/") || normalized.includes("/windows/system32/")) return true;
  return BLOCKED_EXTENSIONS.has(path.extname(base));
}

export function assertWorkspacePath(root, candidate) {
  const rootPath = path.resolve(root);
  const target = path.resolve(rootPath, candidate || ".");
  const relative = path.relative(rootPath, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("PATH_OUTSIDE_WORKSPACE");
  }
  if (isSensitivePath(target)) throw new Error("SENSITIVE_PATH_BLOCKED");
  return target;
}

export function redactSensitiveText(text) {
  return String(text || "")
    .replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[REDACTED PRIVATE MATERIAL]");
}
