import fs from "node:fs";
import path from "node:path";

function findRepoRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(start);
}

export function codingConfig() {
  const repoRoot = findRepoRoot();
  return {
    repoRoot,
    workspaceRoot: path.resolve(process.env.JAZZ_CODING_WORKSPACE_ROOT || path.join(repoRoot, ".jazz", "coding-workspaces")),
    stateRoot: path.resolve(process.env.JAZZ_CODING_STATE_ROOT || path.join(repoRoot, ".jazz", "coding-agent")),
    provider: String(process.env.JAZZ_CODING_PROVIDER || "ollama").toLowerCase(),
    ollamaUrl: String(process.env.JAZZ_CODING_OLLAMA_URL || process.env.JAZZ_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, ""),
    model: String(process.env.JAZZ_CODING_MODEL || "qwen2.5-coder:7b"),
    contextSize: Math.max(4096, Number(process.env.JAZZ_CODING_CONTEXT || 32768)),
    maxTokens: Math.max(512, Number(process.env.JAZZ_CODING_MAX_TOKENS || 8192)),
    maxRepairAttempts: Math.max(0, Math.min(5, Number(process.env.JAZZ_CODING_MAX_REPAIR_ATTEMPTS || 3)))
  };
}
