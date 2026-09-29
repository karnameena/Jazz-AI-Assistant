import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { codingConfig } from "./config.mjs";
import { assertWorkspacePath } from "./security.mjs";

function slugify(value) {
  return String(value || "coding-task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "coding-task";
}

export async function createWorkspace(label) {
  const cfg = codingConfig();
  await fs.mkdir(cfg.workspaceRoot, { recursive: true });
  const id = `${slugify(label)}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const root = assertWorkspacePath(cfg.workspaceRoot, id);
  await fs.mkdir(root, { recursive: false });
  return { id, root };
}

export async function writeWorkspaceFile(root, relativePath, content) {
  const target = assertWorkspacePath(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, String(content), "utf8");
  return target;
}

export async function readWorkspaceFile(root, relativePath) {
  return fs.readFile(assertWorkspacePath(root, relativePath), "utf8");
}

export async function listWorkspaceFiles(root) {
  const output = [];
  async function walk(directory, prefix = "") {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (["node_modules", ".git", "dist", "build"].includes(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), rel);
      else output.push(rel.replace(/\\/g, "/"));
    }
  }
  await walk(root);
  return output.sort();
}
