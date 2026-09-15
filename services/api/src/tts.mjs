import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

function configuredPath(value, fallback) {
  return value ? path.resolve(value) : path.resolve(fallback);
}

export function ttsConfig() {
  const root = process.env.JAZZ_PIPER_ROOT || path.resolve(process.cwd(), "tools", "piper");
  const executable = process.env.JAZZ_PIPER_BIN || path.join(root, process.platform === "win32" ? "piper.exe" : "piper");
  const model = process.env.JAZZ_PIPER_MODEL || path.join(root, "voices", "en_US-amy-medium.onnx");
  return { root, executable: configuredPath(executable, executable), model: configuredPath(model, model) };
}

function runPiper(text, outputFile, config) {
  return new Promise((resolve, reject) => {
    const args = ["--model", config.model, "--output_file", outputFile];
    const child = spawn(config.executable, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`Piper exited with code ${code}: ${stderr.trim() || "unknown error"}`));
    });
    child.stdin.end(text);
  });
}

export async function synthesizeWithPiper(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("Text is required");
  if (clean.length > 4000) throw new Error("Text is too long for one TTS request");

  const config = ttsConfig();
  const [exeStat, modelStat] = await Promise.all([
    fs.stat(config.executable).catch(() => null),
    fs.stat(config.model).catch(() => null)
  ]);
  if (!exeStat) throw new Error(`Piper executable not found: ${config.executable}`);
  if (!modelStat) throw new Error(`Piper voice model not found: ${config.model}`);

  const file = path.join(os.tmpdir(), `jazz-tts-${crypto.randomUUID()}.wav`);
  try {
    await runPiper(clean, file, config);
    return await fs.readFile(file);
  } finally {
    await fs.rm(file, { force: true }).catch(() => {});
  }
}
