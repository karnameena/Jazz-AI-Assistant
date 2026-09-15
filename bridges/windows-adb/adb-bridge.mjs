import http from "node:http";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.JAZZ_ADB_BRIDGE_PORT || 9899);
const adb = process.env.ADB_PATH || "adb";
const reconnectIntervalMs = Number(process.env.JAZZ_ADB_RECONNECT_INTERVAL_MS || 10000);
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
const bashPath = process.env.JAZZ_BASH_PATH || "C:\\Program Files\\Git\\bin\\bash.exe";
const stateFile = join(bridgeDir, ".device-identities.json");
let identityState = {};
try {
  if (existsSync(stateFile)) identityState = JSON.parse(readFileSync(stateFile, "utf8"));
} catch { identityState = {}; }

function saveIdentityState() {
  try { writeFileSync(stateFile, JSON.stringify(identityState, null, 2), "utf8"); } catch { }
}

function run(args, timeout = 15000) {
  return new Promise((resolvePromise, reject) => {
    execFile(adb, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr.trim() || error.message));
      resolvePromise(stdout.trim());
    });
  });
}

function runScript(file, target, args = {}) {
  return new Promise((resolvePromise, reject) => {
    if (!existsSync(file)) return reject(new Error("Script is not installed"));
    const env = {
      ...process.env,
      ADB_PATH: adb,
      JAZZ_DEVICE_ID: target.deviceId,
      JAZZ_ANDROID_SERIAL: target.serial,
      JAZZ_SCRIPT_ARGS: JSON.stringify(args)
    };
    execFile(bashPath, [file], { cwd: scriptRoot, env, timeout: 120000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr.trim() || stdout.trim() || error.message));
      resolvePromise({ ok: true, stdout: stdout.trim(), message: stdout.trim() || "Jazz script completed." });
    });
  });
}

function isConnected(serial) {
  return run(["devices"]).then(output =>
    output.split(/\r?\n/).some(line => line.startsWith(`${serial}\tdevice`))
  ).catch(() => false);
}

async function rememberIdentity(deviceId, serial) {
  if (!serial || serial.includes(":")) return;
  if (identityState[deviceId] !== serial) {
    identityState[deviceId] = serial;
    saveIdentityState();
  }
}

async function rememberIdentityFromConnection(deviceId, target) {
  if (!target.serial) return;
  try {
    const identity = await run(["-s", target.serial, "get-serialno"]);
    await rememberIdentity(deviceId, identity);
  } catch { }
}

async function discoverAndReconnect(deviceId, target) {
  const knownIdentity = identityState[deviceId] || (!target.serial.includes(":") ? target.serial : "");
  if (!knownIdentity) return false;
  let services;
  try { services = await run(["mdns", "services"], 5000); } catch { return false; }
  for (const line of services.split(/\r?\n/)) {
    if (!line.includes("_adb-tls-connect._tcp")) continue;
    const match = line.match(/^\s*(\S+)\s+_adb-tls-connect\._tcp\.?\s+(\d{1,3}(?:\.\d{1,3}){3}:\d+)\s*$/i);
    if (!match || !match[1].includes(knownIdentity)) continue;
    try {
      await run(["connect", match[2]], 8000);
      if (await isConnected(match[2])) {
        target.serial = match[2];
        await rememberIdentityFromConnection(deviceId, target);
        return true;
      }
    } catch { }
  }
  return false;
}

async function ensureConnected(deviceId, target) {
  if (!target.serial) throw new Error("Device serial is not configured");
  if (await isConnected(target.serial)) {
    await rememberIdentityFromConnection(deviceId, target);
    return target.serial;
  }
  if (await discoverAndReconnect(deviceId, target)) return target.serial;
  throw new Error(`${deviceId} is offline. Waiting for ADB Wi-Fi/mDNS reconnect.`);
}

async function ensureForward(deviceId, target) {
  const serial = await ensureConnected(deviceId, target);
  await run(["-s", serial, "forward", `tcp:${target.localPort}`, "tcp:9898"]);
}

async function sendToAndroid(deviceId, target, payload) {
  await ensureForward(deviceId, target);
  const response = await fetch(`http://127.0.0.1:${target.localPort}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.token}` },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!response.ok) throw new Error(data?.error || "Android companion request failed");
  return data;
}

async function reconnectLoop() {
  for (const [deviceId, target] of Object.entries(targets)) {
    if (!target.serial) continue;
    if (await isConnected(target.serial)) {
      await rememberIdentityFromConnection(deviceId, target);
      continue;
    }
    await discoverAndReconnect(deviceId, target).catch(() => false);
  }
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.end(JSON.stringify(data));
}

function body(req) {
  return new Promise((resolvePromise, reject) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; if (raw.length > 64 * 1024) req.destroy(); });
    req.on("end", () => { try { resolvePromise(JSON.parse(raw || "{}")); } catch (e) { reject(e); } });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true, service: "jazz-adb-bridge", autoReconnect: true, scripts: true });
  }
  if (req.method === "GET" && req.url === "/devices") {
    try {
      await reconnectLoop();
      const targetEntries = await Promise.all(
        Object.entries(targets).map(async ([id, target]) => [
          id,
          {
            serial: target.serial,
            identity: identityState[id] || null,
            connected: target.serial ? await isConnected(target.serial) : false
          }
        ])
      );
      return json(res, 200, {
        ok: true,
        adb: await run(["devices", "-l"]),
        targets: Object.fromEntries(targetEntries)
      });
    } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
  }
  if (req.method !== "POST" || !["/command", "/script"].includes(req.url)) return json(res, 404, { ok: false, error: "Not found" });
  try {
    const input = await body(req);
    const target = targets[input.deviceId];
    if (!target) return json(res, 404, { ok: false, error: "Unknown device" });
    const serial = await ensureConnected(input.deviceId, target);

    if (req.url === "/script") {
      const scriptName = String(input.scriptName || "");
      if (!/^[a-z0-9_-]+$/.test(scriptName)) return json(res, 400, { ok: false, error: "Invalid script name" });

      // Keep credential-entry workflows explicitly registered so Jazz can explain
      // why they are unavailable, but never execute them through the bridge.
      const registeredScripts = new Set(["paymom", "unlock", "unlockmobile", "instagram", "youtube", "screenshot"]);
      const credentialScripts = new Set(["unlock", "unlockmobile"]);
      if (!registeredScripts.has(scriptName)) return json(res, 403, { ok: false, error: "Script is not registered" });
      if (credentialScripts.has(scriptName)) {
        return json(res, 403, {
          ok: false,
          status: "credential_action_requires_manual_entry",
          error: "Credential-entry scripts cannot be executed automatically by the Jazz bridge.",
          scriptName
        });
      }

      const scriptFile = resolve(scriptRoot, `${scriptName}.sh`);
      if (!scriptFile.startsWith(`${scriptRoot}\\`) && !scriptFile.startsWith(`${scriptRoot}/`)) return json(res, 403, { ok: false, error: "Invalid script path" });
      target.deviceId = input.deviceId;
      target.serial = serial;
      const result = await runScript(scriptFile, target, input.args || {});
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
  reconnectLoop().catch(() => { });
  setInterval(() => reconnectLoop().catch(() => { }), reconnectIntervalMs);
});
