import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");

function configuredPath(value, fallback) {
  return path.resolve(value || fallback);
}

function firstExisting(candidates) {
  return candidates.find(candidate => candidate && existsSync(candidate)) || candidates.find(Boolean) || "";
}

export function ttsConfig() {
  const defaultRoot = path.join(repoRoot, "tools", "piper");
  const root = configuredPath(process.env.JAZZ_PIPER_ROOT, defaultRoot);

  // Prefer a complete self-contained runtime directory. Older Jazz setup versions
  // copied piper.exe by itself, which loses required DLLs on Windows.
  const executable = firstExisting([
    process.env.JAZZ_PIPER_BIN ? path.resolve(process.env.JAZZ_PIPER_BIN) : "",
    path.join(root, "runtime", process.platform === "win32" ? "piper.exe" : "piper"),
    path.join(root, "piper", process.platform === "win32" ? "piper.exe" : "piper"),
    path.join(root, process.platform === "win32" ? "piper.exe" : "piper")
  ]);

  const model = firstExisting([
    process.env.JAZZ_PIPER_MODEL ? path.resolve(process.env.JAZZ_PIPER_MODEL) : "",
    path.join(root, "voices", "en_US-amy-medium.onnx")
  ]);

  const runtimeDir = path.dirname(executable || root);
  const espeakData = firstExisting([
    process.env.JAZZ_PIPER_ESPEAK_DATA ? path.resolve(process.env.JAZZ_PIPER_ESPEAK_DATA) : "",
    path.join(runtimeDir, "espeak-ng-data"),
    path.join(root, "runtime", "espeak-ng-data"),
    path.join(root, "piper", "espeak-ng-data"),
    path.join(root, "espeak-ng-data")
  ]);

  return { root, runtimeDir, executable, model, espeakData };
}

export async function getTtsStatus() {
  const config = ttsConfig();
  const [exeStat, modelStat, espeakStat] = await Promise.all([
    fs.stat(config.executable).catch(() => null),
    fs.stat(config.model).catch(() => null),
    fs.stat(config.espeakData).catch(() => null)
  ]);
  return {
    ok: Boolean(exeStat && modelStat && espeakStat),
    executable: config.executable,
    executableFound: Boolean(exeStat),
    runtimeDir: config.runtimeDir,
    model: config.model,
    modelFound: Boolean(modelStat),
    espeakData: config.espeakData,
    espeakDataFound: Boolean(espeakStat),
    setupScript: path.join(repoRoot, "tools", "piper", "setup-windows.ps1")
  };
}

async function validatePiper(config) {
  const status = await getTtsStatus();
  if (!status.executableFound) throw new Error(`Piper executable not found: ${status.executable}`);
  if (!status.modelFound) throw new Error(`Piper voice model not found: ${status.model}`);
  if (!status.espeakDataFound) throw new Error(`Piper eSpeak data not found: ${status.espeakData}`);
}

function piperEnv(config) {
  return {
    ...process.env,
    ...(process.platform === "win32"
      ? { PATH: `${config.runtimeDir}${path.delimiter}${process.env.PATH || ""}` }
      : {})
  };
}

function piperExitError(code, stderr) {
  const detail = String(stderr || "").trim();
  if (Number(code) === 3221225781 || Number(code) === -1073741515) {
    return new Error("Piper could not load a required Windows DLL (0xC0000135). Re-run tools/piper/setup-windows.ps1 so Jazz installs the complete Piper runtime, not only piper.exe.");
  }
  return new Error(`Piper exited with code ${code}: ${detail || "unknown error"}`);
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
      cwd: config.runtimeDir,
      env: piperEnv(config),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(piperExitError(code, stderr));
    });
    child.stdin.end(text);
  });
}

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
      console.log(`[Jazz] Piper ready: ${config.executable}`);
      return true;
    } finally {
      await fs.rm(file, { force: true }).catch(() => {});
    }
  })().catch(error => {
    console.warn(`[Jazz] Piper unavailable; browser TTS fallback remains enabled. ${error instanceof Error ? error.message : String(error)}`);
    return false;
  });

  return prewarmPromise;
}

void prewarmPiper();

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
      cwd: config.runtimeDir,
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
      else finish(piperExitError(code, stderr));
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
