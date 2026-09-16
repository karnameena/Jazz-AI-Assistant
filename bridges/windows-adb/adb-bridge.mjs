import http from "node:http";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.JAZZ_ADB_BRIDGE_PORT || 9899);
const adb = process.env.ADB_PATH || "adb";
const reconnectIntervalMs = Number(process.env.JAZZ_ADB_RECONNECT_INTERVAL_MS || 10000);
const scriptTimeoutMs = Number(process.env.JAZZ_SCRIPT_TIMEOUT_MS || 120000);
const powershellPath = process.env.JAZZ_POWERSHELL_PATH || "powershell.exe";
const bashPath = process.env.JAZZ_BASH_PATH || "C:\\Program Files\\Git\\bin\\bash.exe";
const phoneSerial = process.env.JAZZ_ANDROID_PHONE_SERIAL || "";
const tabletSerial = process.env.JAZZ_ANDROID_TABLET_SERIAL || "";
const phoneToken = process.env.JAZZ_ANDROID_PHONE_TOKEN || "";
const tabletToken = process.env.JAZZ_ANDROID_TABLET_TOKEN || "";
const targets = {
  "android-phone": { serial: phoneSerial, localPort: 19001, token: phoneToken },
  "android-tablet": { serial: tabletSerial, localPort: 19002, token: tabletToken }
};

const bridgeDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(bridgeDir, "../..");
const scriptRoot = resolve(process.env.JAZZ_SCRIPT_ROOT || join(repoRoot, "scripts", "android"));
const stateFile = join(bridgeDir, ".device-identities.json");
let identityState = {};
try { if (existsSync(stateFile)) identityState = JSON.parse(readFileSync(stateFile, "utf8")); } catch { identityState = {}; }
function saveIdentityState() { try { writeFileSync(stateFile, JSON.stringify(identityState, null, 2), "utf8"); } catch {} }

function run(args, timeout = 15000) {
  return new Promise((resolvePromise, reject) => {
    execFile(adb, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr.trim() || error.message));
      resolvePromise(stdout.trim());
    });
  });
}

function confirmedAmount(requestArgs = {}) {
  const amount = Number(requestArgs.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100000) throw new Error("A valid confirmed payment amount is required");
  return amount;
}

const approvedScripts = Object.freeze({
  unlockmobile: { file: "unlockmobile.ps1", runner: "powershell", args: ({ serial }) => ["-Serial", serial] },
  paymom: { file: "pay-mom.ps1", runner: "powershell", args: ({ serial, requestArgs }) => ["-Serial", serial, "-Amount", String(confirmedAmount(requestArgs))] },
  instagram: { file: "instagram.sh", runner: "bash" },
  youtube: { file: "youtube.sh", runner: "bash" },
  screenshot: { file: "screenshot.sh", runner: "bash" }
});

function safeScriptPath(fileName) {
  const safeName = basename(fileName);
  if (safeName !== fileName) throw new Error("Invalid script filename");
  const file = resolve(scriptRoot, safeName);
  const rootPrefix = `${scriptRoot}${process.platform === "win32" ? "\\" : "/"}`;
  if (!file.startsWith(rootPrefix)) throw new Error("Invalid script path");
  return file;
}

function successMessage(scriptName, requestArgs = {}) {
  if (scriptName === "paymom") {
    const amount = confirmedAmount(requestArgs);
    return `Recipient: Meena alice mom\nAmount: Rs.${amount}\nJazz payment workflow completed.`;
  }
  return null;
}

function runScript(scriptName, target, requestArgs = {}) {
  return new Promise((resolvePromise, reject) => {
    try {
      const spec = approvedScripts[scriptName];
      if (!spec) return reject(new Error("Script is not registered"));
      const file = safeScriptPath(spec.file);
      if (!existsSync(file)) return reject(new Error(`Approved script is not installed: ${spec.file}`));
      const env = { ...process.env, ADB_PATH: adb, JAZZ_DEVICE_ID: target.deviceId, JAZZ_ANDROID_SERIAL: target.serial, JAZZ_SCRIPT_ARGS: JSON.stringify(requestArgs) };
      let executable;
      let args;
      if (spec.runner === "powershell") {
        executable = powershellPath;
        args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file, ...(spec.args ? spec.args({ serial: target.serial, requestArgs }) : [])];
      } else {
        executable = bashPath;
        args = [file];
      }
      execFile(executable, args, { cwd: scriptRoot, env, timeout: scriptTimeoutMs, windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          const timeoutText = error.killed ? `Script timed out after ${scriptTimeoutMs}ms` : "";
          return reject(new Error(stderr.trim() || stdout.trim() || timeoutText || error.message));
        }
        const message = successMessage(scriptName, requestArgs) || stdout.trim() || `Jazz completed ${spec.file}.`;
        resolvePromise({ ok: true, scriptName, file: spec.file, stdout: stdout.trim(), message });
      });
    } catch (error) { reject(error); }
  });
}

function isConnected(serial) { return run(["devices"]).then(output => output.split(/\r?\n/).some(line => line.startsWith(`${serial}\tdevice`))).catch(() => false); }
async function rememberIdentity(deviceId, serial) { if (!serial || serial.includes(":")) return; if (identityState[deviceId] !== serial) { identityState[deviceId] = serial; saveIdentityState(); } }
async function rememberIdentityFromConnection(deviceId, target) { if (!target.serial) return; try { const identity = await run(["-s", target.serial, "get-serialno"]); await rememberIdentity(deviceId, identity); } catch {} }
async function discoverAndReconnect(deviceId, target) {
  const knownIdentity = identityState[deviceId] || (!target.serial.includes(":") ? target.serial : "");
  if (!knownIdentity) return false;
  let services; try { services = await run(["mdns", "services"], 5000); } catch { return false; }
  for (const line of services.split(/\r?\n/)) {
    if (!line.includes("_adb-tls-connect._tcp")) continue;
    const match = line.match(/^\s*(\S+)\s+_adb-tls-connect\._tcp\.?\s+(\d{1,3}(?:\.\d{1,3}){3}:\d+)\s*$/i);
    if (!match || !match[1].includes(knownIdentity)) continue;
    try { await run(["connect", match[2]], 8000); if (await isConnected(match[2])) { target.serial = match[2]; await rememberIdentityFromConnection(deviceId, target); return true; } } catch {}
  }
  return false;
}
async function ensureConnected(deviceId, target) { if (!target.serial) throw new Error("Device serial is not configured"); if (await isConnected(target.serial)) { await rememberIdentityFromConnection(deviceId, target); return target.serial; } if (await discoverAndReconnect(deviceId, target)) return target.serial; throw new Error(`${deviceId} is offline. Waiting for ADB Wi-Fi/mDNS reconnect.`); }
async function ensureForward(deviceId, target) { const serial = await ensureConnected(deviceId, target); await run(["-s", serial, "forward", `tcp:${target.localPort}`, "tcp:9898"]); }
async function sendToAndroid(deviceId, target, payload) { await ensureForward(deviceId, target); const response = await fetch(`http://127.0.0.1:${target.localPort}/command`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.token}` }, body: JSON.stringify(payload) }); const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = { message: text }; } if (!response.ok) throw new Error(data?.error || "Android companion request failed"); return data; }
async function reconnectLoop() { for (const [deviceId, target] of Object.entries(targets)) { if (!target.serial) continue; if (await isConnected(target.serial)) { await rememberIdentityFromConnection(deviceId, target); continue; } await discoverAndReconnect(deviceId, target).catch(() => false); } }
function json(res, status, data) { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173"); res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization"); res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); res.end(JSON.stringify(data)); }
function body(req) { return new Promise((resolvePromise, reject) => { let raw = ""; req.on("data", chunk => { raw += chunk; if (raw.length > 64 * 1024) req.destroy(); }); req.on("end", () => { try { resolvePromise(JSON.parse(raw || "{}")); } catch (e) { reject(e); } }); }); }

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, service: "jazz-adb-bridge", autoReconnect: true, scripts: true, powershellScripts: true });
  if (req.method === "GET" && req.url === "/devices") {
    try { await reconnectLoop(); const targetEntries = await Promise.all(Object.entries(targets).map(async ([id, target]) => [id, { serial: target.serial, identity: identityState[id] || null, connected: target.serial ? await isConnected(target.serial) : false }])); return json(res, 200, { ok: true, adb: await run(["devices", "-l"]), targets: Object.fromEntries(targetEntries) }); }
    catch (e) { return json(res, 500, { ok: false, error: e.message }); }
  }
  if (req.method !== "POST" || !["/command", "/script"].includes(req.url)) return json(res, 404, { ok: false, error: "Not found" });
  try {
    const input = await body(req); const target = targets[input.deviceId]; if (!target) return json(res, 404, { ok: false, error: "Unknown device" });
    const serial = await ensureConnected(input.deviceId, target);
    if (req.url === "/script") {
      const scriptName = String(input.scriptName || "").toLowerCase();
      if (!/^[a-z0-9_-]+$/.test(scriptName)) return json(res, 400, { ok: false, error: "Invalid script name" });
      if (!approvedScripts[scriptName]) return json(res, 403, { ok: false, error: "Script is not registered" });
      target.deviceId = input.deviceId; target.serial = serial;
      const result = await runScript(scriptName, target, input.args || {});
      return json(res, 200, result);
    }
    const action = String(input.action || "");
    const allowed = new Set(["device_info", "open_url", "launch_app", "home", "back", "recents", "notifications", "tap", "swipe", "click_text", "read_screen"]);
    if (!allowed.has(action)) return json(res, 400, { ok: false, error: "Action not allowed" });
    const data = await sendToAndroid(input.deviceId, target, { deviceId: input.deviceId, action, args: input.args || {} });
    return json(res, data.ok === false ? 400 : 200, data);
  } catch (e) { return json(res, 503, { ok: false, error: e.message }); }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Jazz Windows ADB bridge listening on 127.0.0.1:${port}`);
  console.log(`ADB Wi-Fi auto-reconnect enabled; scan interval ${reconnectIntervalMs}ms`);
  console.log(`Approved Android scripts enabled from ${scriptRoot}`);
  console.log(`PowerShell workflow support enabled (${powershellPath})`);
  reconnectLoop().catch(() => {}); setInterval(() => reconnectLoop().catch(() => {}), reconnectIntervalMs);
});
