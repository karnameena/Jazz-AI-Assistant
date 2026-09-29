import fs from "node:fs/promises";
import path from "node:path";
import { codingConfig } from "./config.mjs";

let cache = null;

function filePath() {
  return path.join(codingConfig().stateRoot, "sessions.json");
}

async function loadAll() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await fs.readFile(filePath(), "utf8"));
    cache = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn(`[Jazz Coding] session store read failed: ${error.message}`);
    cache = [];
  }
  return cache;
}

async function persist(items) {
  const target = filePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  await fs.writeFile(temp, JSON.stringify(items, null, 2), "utf8");
  await fs.rename(temp, target);
}

export async function createSession(session) {
  const items = await loadAll();
  items.push(session);
  await persist(items);
  return { ...session };
}

export async function updateSession(id, patch) {
  const items = await loadAll();
  const index = items.findIndex(item => item.id === id);
  if (index < 0) return null;
  items[index] = { ...items[index], ...patch, updatedAt: new Date().toISOString() };
  await persist(items);
  return { ...items[index] };
}

export async function getSession(id) {
  const items = await loadAll();
  const item = items.find(entry => entry.id === id);
  return item ? { ...item } : null;
}

export async function latestSession() {
  const items = await loadAll();
  return items.length ? { ...items[items.length - 1] } : null;
}

export async function listSessions() {
  return (await loadAll()).map(item => ({ ...item }));
}
