import http from "node:http";
import { spawn } from "node:child_process";
import { getScript, scriptPath } from "../../services/api/src/script-registry.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.JAZZ_ADB_BRIDGE_PORT || 9899);
const ADB = process.env.JAZZ_ADB_PATH || "adb";

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS"
  });
  res.end(JSON.stringify(body));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let value = "";
    req.on("data", chunk => { value += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(value || "{}")); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function run(command, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Command timed out."));
    }, timeoutMs);
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error((stderr || stdout || `Exit code ${code}`).trim()));
      else resolve(stdout.trim());
    });
  });
}

function serialOf(deviceId) {
  if (deviceId === "android-phone") return process.env.JAZZ_ANDROID_PHONE_SERIAL || "";
  if (deviceId === "android-tablet") return process.env.JAZZ_ANDROID_TABLET_SERIAL || "";
  throw new Error("Unknown Android device.");
}

async function runRegisteredScript(deviceId, scriptName, args = {}) {
  const script = getScript(scriptName);
  const path = scriptPath(scriptName);
  if (!script || !path) throw new Error(`Registered script '${scriptName}' is not installed.`);

  // Financial transactions are intentionally not executed automatically by this bridge.
  if (script.category === "financial") {
    throw new Error("Financial scripts are registered but cannot be automatically executed by the Jazz ADB bridge.");
  }

  const serial = serialOf(deviceId);
  if (!serial) throw new Error(`${deviceId} serial is not configured.`);

  const commandArgs = [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", path,
    "-Serial", serial
  ];

  if (args.amount !== null && args.amount !== undefined) {
    commandArgs.push("-Amount", String(args.amount));
  }

  const output = await run("powershell.exe", commandArgs, 120000);
  return { ok: true, status: "completed", scriptName, deviceId, message: output || `${script.file} completed.` };
}

async function runAllowedCommand(deviceId, action, args = {}) {
  const serial = serialOf(deviceId);
  if (!serial) throw new Error(`${deviceId} serial is not configured.`);

  const allowed = {
    wake: ["shell", "input", "keyevent", "KEYCODE_WAKEUP"],
    home: ["shell", "input", "keyevent", "KEYCODE_HOME"],
    back: ["shell", "input", "keyevent", "KEYCODE_BACK"]
  };
  const adbArgs = allowed[action];
  if (!adbArgs) throw new Error(`ADB action '${action}' is not allow-listed.`);
  await run(ADB, ["-s", serial, ...adbArgs]);
  return { ok: true, status: "completed", action, deviceId };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  try {
    const payload = await body(req);
    if (req.url === "/script") return json(res, 200, await runRegisteredScript(payload.deviceId, payload.scriptName, payload.args || {}));
    if (req.url === "/command") return json(res, 200, await runAllowedCommand(payload.deviceId, payload.action, payload.args || {}));
    return json(res, 404, { error: "Unknown bridge route" });
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[Jazz ADB Bridge] listening on http://${HOST}:${PORT}`);
});
