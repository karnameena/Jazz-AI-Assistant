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
  const runtimeDir = process.platform === "win32" ? path.join(root, "piper") : root;
  const executable = process.env.JAZZ_PIPER_BIN || path.join(root, process.platform === "win32" ? "piper.exe" : "piper");
  const model = process.env.JAZZ_PIPER_MODEL || path.join(root, "voices", "en_US-amy-medium.onnx");
  const espeakData = process.env.JAZZ_PIPER_ESPEAK_DATA || path.join(runtimeDir, "espeak-ng-data");
  return {
    root: configuredPath(root, root),
    runtimeDir: configuredPath(runtimeDir, runtimeDir),
    executable: configuredPath(executable, executable),
    model: configuredPath(model, model),
    espeakData: configuredPath(espeakData, espeakData)
  };
}

async function validatePiper(config) {
  const [exeStat, modelStat, espeakStat] = await Promise.all([
    fs.stat(config.executable).catch(() => null),
    fs.stat(config.model).catch(() => null),
    fs.stat(config.espeakData).catch(() => null)
  ]);
  if (!exeStat) throw new Error(`Piper executable not found: ${config.executable}`);
  if (!modelStat) throw new Error(`Piper voice model not found: ${config.model}`);
  if (!espeakStat) throw new Error(`Piper eSpeak data not found: ${config.espeakData}`);
}

function piperEnv(config) {
  return {
    ...process.env,
    ...(process.platform === "win32"
      ? { PATH: `${config.runtimeDir}${path.delimiter}${process.env.PATH || ""}` }
      : {})
  };
}

function runPiper(text, outputFile, config) {
  return new Promise((resolve, reject) => {
    const args = [
      "--model", config.model,
      "--espeak_data", config.espeakData,
      "--output_file", outputFile
    ];
    const child = spawn(config.executable, args, {
      windowsHide: true,
      env: piperEnv(config),
      stdio: ["pipe", "pipe", "pipe"]
    });
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

/**
 * Warm the Piper executable/model once when the API process starts.
 * This does not play anything in the browser. It moves the expensive
 * executable/model/disk-cache work out of Mama's first spoken reply.
 */
let prewarmPromise = null;
export async function prewarmPiper() {
  if (process.env.JAZZ_PIPER_PREWARM === "false") return false;
  if (prewarmPromise) return prewarmPromise;

  prewarmPromise = (async () => {
    const config = ttsConfig();
    await validatePiper(config);
    const file = path.join(os.tmpdir(), `jazz-tts-prewarm-${crypto.randomUUID()}.wav`);
    try {
      await runPiper("Jazz ready.", file, config);
      return true;
    } finally {
      await fs.rm(file, { force: true }).catch(() => {});
    }
  })().catch(error => {
    // Prewarming is an optimization only. Never make API startup fail because
    // Piper is missing; the normal TTS request will report the real error.
    console.warn(`Jazz Piper prewarm skipped: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  });

  return prewarmPromise;
}

// Start model/executable warm-up as soon as the TTS module is loaded.
void prewarmPiper();

/**
 * Stream Piper's raw PCM16LE output as it is generated.
 * The browser can consume these chunks immediately through Web Audio.
 */
export async function streamPiperRaw(text, onChunk) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("Text is required");
  if (clean.length > 4000) throw new Error("Text is too long for one TTS request");

  const config = ttsConfig();
  await validatePiper(config);

  const args = [
    "--model", config.model,
    "--espeak_data", config.espeakData,
    "--output-raw"
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(config.executable, args, {
      windowsHide: true,
      env: piperEnv(config),
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stderr = "";
    let settled = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };

    child.stdout.on("data", chunk => {
      if (chunk?.length) onChunk(Buffer.from(chunk));
    });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => finish(error));
    child.on("close", code => {
      if (code === 0) finish();
      else finish(new Error(`Piper exited with code ${code}: ${stderr.trim() || "unknown error"}`));
    });

    child.stdin.on("error", () => {});
    child.stdin.end(`${clean}\n`);
  });
}

export async function synthesizeWithPiper(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("Text is required");
  if (clean.length > 4000) throw new Error("Text is too long for one TTS request");

  const config = ttsConfig();
  await validatePiper(config);

  const file = path.join(os.tmpdir(), `jazz-tts-${crypto.randomUUID()}.wav`);
  try {
    await runPiper(clean, file, config);
    return await fs.readFile(file);
  } finally {
    await fs.rm(file, { force: true }).catch(() => {});
  }
}
