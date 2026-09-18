import http from "node:http";
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.JAZZ_ADB_BRIDGE_PORT || 9899);
const adb = process.env.ADB_PATH || "adb";
const reconnectIntervalMs = Number(process.env.JAZZ_ADB_RECONNECT_INTERVAL_MS || 10000);
const phoneSerial = process.env.JAZZ_ANDROID_PHONE_SERIAL || "";
const tabletSerial = process.env.JAZZ_ANDROID_TABLET_SERIAL || "";
const phoneToken = process.env.JAZZ_ANDROID_PHONE_TOKEN || "";
const tabletToken = process.env.JAZZ_ANDROID_TABLET_TOKEN || "";
const targets = {
  "android-phone": { serial: phoneSerial, configuredSerial: phoneSerial, localPort: 19001, token: phoneToken },
  "android-tablet": { serial: tabletSerial, configuredSerial: tabletSerial, localPort: 19002, token: tabletToken }
};

const bridgeDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(bridgeDir, "../..");
const scriptRoot = resolve(process.env.JAZZ_SCRIPT_ROOT || join(repoRoot, "scripts", "android"));
const bashPath = process.env.JAZZ_BASH_PATH || "C:\\Program Files\\Git\\bin\\bash.exe";
const powershellPath = process.env.JAZZ_POWERSHELL_PATH || "powershell.exe";
const stateFile = join(bridgeDir, ".device-identities.json");
let identityState = {};
try { if (existsSync(stateFile)) identityState = JSON.parse(readFileSync(stateFile, "utf8")); } catch { identityState = {}; }

const registeredScriptFiles = {
  unlock: ["unlockmobile.ps1"],
  unlockmobile: ["unlockmobile.ps1"],
  paymom: ["pay-mom.ps1", "Payto_Mom.ps1", "paymom.ps1", "paymom.sh"],
  instagram: ["instagram.ps1", "instagram.sh", "insta.sh"],
  youtube: ["youtube.ps1", "youtube.sh"],
  screenshot: ["screenshot.ps1", "screenshot.sh"]
};

function saveIdentityState() { try { writeFileSync(stateFile, JSON.stringify(identityState, null, 2), "utf8"); } catch {} }
function sleep(ms) { return new Promise(resolvePromise => setTimeout(resolvePromise, ms)); }
function run(args, timeout = 15000) {
  return new Promise((resolvePromise, reject) => execFile(
    adb,
    args,
    { timeout, windowsHide: true },
    (error, stdout, stderr) => error
      ? reject(new Error(stderr.trim() || error.message))
      : resolvePromise(stdout.trim())
  ));
}

function resolveRegisteredScriptFile(scriptName) {
  const candidates = registeredScriptFiles[scriptName];
  if (!candidates) return null;
  const rootPrefix = `${scriptRoot}${process.platform === "win32" ? "\\" : "/"}`;

  for (const candidate of candidates) {
    const file = resolve(scriptRoot, basename(candidate));
    if (!file.startsWith(rootPrefix)) continue;
    if (existsSync(file)) return file;
  }
  return null;
}

function normalizeScriptResult(file, stdout) {
  const output = String(stdout || "").trim();
  const lastLine = output.split(/\r?\n/).filter(Boolean).pop() || "";
  try {
    const parsed = JSON.parse(lastLine);
    if (parsed && typeof parsed === "object") {
      return {
        ...parsed,
        ok: parsed.ok !== false,
        stdout: output,
        script: parsed.script || basename(file),
        executedScript: true
      };
    }
  } catch {}

  return {
    ok: true,
    stdout: output,
    message: output || `${basename(file)} completed.`,
    script: basename(file),
    executedScript: true
  };
}

function amountFromArgs(args = {}) {
  if (args?.amount !== null && args?.amount !== undefined && Number.isFinite(Number(args.amount))) {
    return Number(args.amount);
  }
  const request = String(args?.request || "");
  const match = request.match(/(?:₹|rs\.?|inr\s*)\s*(\d+(?:\.\d+)?)/i)
    || request.match(/\b(\d+(?:\.\d+)?)\s*(?:rupee|rupees|rs)\b/i);
  return match ? Number(match[1]) : null;
}

function buildScriptLaunch(file, target, args = {}) {
  const adbDir = adb && adb !== "adb" ? dirname(adb) : "";
  const inheritedPath = process.env.PATH || process.env.Path || "";
  const amount = amountFromArgs(args);
  const env = {
    ...process.env,
    PATH: adbDir ? `${adbDir};${inheritedPath}` : inheritedPath,
    Path: adbDir ? `${adbDir};${inheritedPath}` : inheritedPath,
    ADB_PATH: adb,
    JAZZ_DEVICE_ID: target.deviceId,
    JAZZ_ANDROID_SERIAL: target.serial,
    JAZZ_ANDROID_PHONE_SERIAL: target.deviceId === "android-phone" ? target.serial : (process.env.JAZZ_ANDROID_PHONE_SERIAL || ""),
    JAZZ_ANDROID_TABLET_SERIAL: target.deviceId === "android-tablet" ? target.serial : (process.env.JAZZ_ANDROID_TABLET_SERIAL || ""),
    JAZZ_SCRIPT_ARGS: JSON.stringify({ ...args, amount })
  };
  if (amount !== null) env.JAZZ_PAYMENT_AMOUNT = String(amount);

  const extension = extname(file).toLowerCase();
  const command = extension === ".ps1" ? powershellPath : bashPath;
  const commandArgs = extension === ".ps1"
    ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file]
    : [file];

  return { command, commandArgs, env, amount };
}

function runScript(file, target, args = {}) {
  return new Promise((resolvePromise, reject) => {
    if (!file || !existsSync(file)) return reject(new Error("Script is not installed"));

    const { command, commandArgs, env } = buildScriptLaunch(file, target, args);
    execFile(
      command,
      commandArgs,
      { cwd: scriptRoot, env, timeout: 120000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const details = [String(stderr || "").trim(), String(stdout || "").trim(), String(error.message || "").trim()]
            .filter(Boolean)
            .join(" | ");
          reject(new Error(`${basename(file)} failed${error.code !== undefined ? ` (exit ${error.code})` : ""}: ${details || "unknown script error"}`));
          return;
        }
        resolvePromise(normalizeScriptResult(file, stdout));
      }
    );
  });
}

function startScriptDetached(file, target, args = {}) {
  return new Promise((resolvePromise, reject) => {
    if (!file || !existsSync(file)) return reject(new Error("Script is not installed"));
    const { command, commandArgs, env, amount } = buildScriptLaunch(file, target, args);
    const child = spawn(command, commandArgs, {
      cwd: scriptRoot,
      env,
      windowsHide: true,
      detached: true,
      stdio: "ignore"
    });
    let settled = false;
    child.once("error", error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolvePromise({
        ok: true,
        status: "started",
        message: `${basename(file)} started${amount !== null ? ` for ₹${amount}` : ""}.`,
        script: basename(file),
        executedScript: true,
        amount
      });
    });
  });
}

function isTcpSerial(serial) { return /^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(String(serial || "")); }
function parseConnectedDevices(output) {
  return output.split(/\r?\n/).slice(1).map(line => line.trim()).filter(Boolean).map(line => ({ serial: line.split(/\s+/)[0], line })).filter(item => /\sdevice(?:\s|$)/.test(item.line));
}
async function connectedDevices() { try { return parseConnectedDevices(await run(["devices", "-l"])); } catch { return []; } }
async function isConnected(serial) { return (await connectedDevices()).some(item => item.serial === serial); }
async function rememberIdentity(deviceId, serial) {
  if (!serial || serial === "unknown" || isTcpSerial(serial)) return;
  if (identityState[deviceId] !== serial) { identityState[deviceId] = serial; saveIdentityState(); }
}
async function rememberIdentityFromConnection(deviceId, target) {
  if (!target.serial) return;
  try { await rememberIdentity(deviceId, await run(["-s", target.serial, "get-serialno"])); } catch {}
}

async function adoptExistingTransport(deviceId, target) {
  const devices = await connectedDevices();
  if (!devices.length) return false;
  const known = identityState[deviceId] || "";
  let candidate = known ? devices.find(item => item.serial.includes(known)) : null;
  if (!candidate && devices.length === 1) candidate = devices[0];
  if (!candidate) return false;
  target.serial = candidate.serial;
  await rememberIdentityFromConnection(deviceId, target);
  console.log(`[ADB] ${deviceId}: adopted active transport ${target.serial}`);
  return true;
}

async function directReconnect(deviceId, target) {
  const candidates = [...new Set([target.serial, target.configuredSerial].filter(isTcpSerial))];
  for (const endpoint of candidates) {
    try {
      console.log(`[ADB] ${deviceId}: trying direct reconnect to ${endpoint}`);
      await run(["connect", endpoint], 8000).catch(() => "");
      await sleep(500);
      if (await isConnected(endpoint)) {
        target.serial = endpoint;
        await rememberIdentityFromConnection(deviceId, target);
        console.log(`[ADB] ${deviceId}: connected to ${endpoint}`);
        return true;
      }
    } catch {}
  }
  return false;
}

function parseMdnsEndpoint(line) {
  if (!line.includes("_adb-tls-connect._tcp")) return null;
  const endpoint = line.match(/(\d{1,3}(?:\.\d{1,3}){3}:\d+)/)?.[1];
  if (!endpoint) return null;
  return { serviceName: line.trim().split(/\s+/)[0] || "", endpoint };
}

async function discoverAndReconnect(deviceId, target) {
  let services;
  try { services = await run(["mdns", "services"], 5000); } catch { return false; }
  const entries = services.split(/\r?\n/).map(parseMdnsEndpoint).filter(Boolean);
  if (!entries.length) return false;
  const knownIdentity = identityState[deviceId] || "";
  const preferred = knownIdentity ? entries.filter(entry => entry.serviceName.includes(knownIdentity)) : [];
  const candidates = preferred.length ? preferred : (entries.length === 1 ? entries : []);
  for (const entry of candidates) {
    try {
      await run(["connect", entry.endpoint], 8000).catch(() => "");
      await sleep(500);
      if (await isConnected(entry.endpoint)) {
        target.serial = entry.endpoint;
        await rememberIdentityFromConnection(deviceId, target);
        console.log(`[ADB] ${deviceId}: recovered through mDNS at ${entry.endpoint}`);
        return true;
      }
    } catch {}
  }
  return false;
}

async function ensureConnected(deviceId, target) {
  if (target.serial && await isConnected(target.serial)) {
    await rememberIdentityFromConnection(deviceId, target);
    return target.serial;
  }
  if (await adoptExistingTransport(deviceId, target)) return target.serial;
  if (await directReconnect(deviceId, target)) return target.serial;
  if (await discoverAndReconnect(deviceId, target)) return target.serial;
  throw new Error(`${deviceId} is offline. Automatic ADB reconnect failed. Check that Wireless debugging is enabled and the devices are on the same reachable network.`);
}

async function ensureForward(deviceId, target) {
  const serial = await ensureConnected(deviceId, target);
  await run(["-s", serial, "forward", `tcp:${target.localPort}`, "tcp:9898"]);
}

async function wakeDevice(deviceId, target) {
  const serial = await ensureConnected(deviceId, target);
  await run(["-s", serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
  return {
    ok: true,
    status: "authentication_required",
    message: `${deviceId === "android-tablet" ? "Tablet" : "Mobile"} is awake. Authenticate on the device, then Jazz can continue.`,
    deviceId
  };
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
    if (target.serial && await isConnected(target.serial)) {
      await rememberIdentityFromConnection(deviceId, target);
      continue;
    }
    if (await adoptExistingTransport(deviceId, target)) continue;
    if (await directReconnect(deviceId, target)) continue;
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
    req.on("end", () => {
      try { resolvePromise(JSON.parse(raw || "{}")); }
      catch (e) { reject(e); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, {
      ok: true,
      service: "jazz-adb-bridge",
      autoReconnect: true,
      activeTransportDiscovery: true,
      directReconnect: true,
      mdnsReconnect: true,
      scripts: true,
      powershellScripts: true
    });
  }
  if (req.method === "GET" && req.url === "/devices") {
    try {
      await reconnectLoop();
      const targetEntries = await Promise.all(Object.entries(targets).map(async ([id, target]) => [id, {
        serial: target.serial,
        configuredSerial: target.configuredSerial,
        identity: identityState[id] || null,
        connected: target.serial ? await isConnected(target.serial) : false
      }]));
      return json(res, 200, { ok: true, adb: await run(["devices", "-l"]), targets: Object.fromEntries(targetEntries) });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (req.method !== "POST" || !["/command", "/script"].includes(req.url)) {
    return json(res, 404, { ok: false, error: "Not found" });
  }

  try {
    const input = await body(req);
    const target = targets[input.deviceId];
    if (!target) return json(res, 404, { ok: false, error: "Unknown device" });
    const serial = await ensureConnected(input.deviceId, target);

    if (req.url === "/script") {
      const scriptName = String(input.scriptName || "");
      if (!/^[a-z0-9_-]+$/.test(scriptName)) return json(res, 400, { ok: false, error: "Invalid script name" });
      if (!Object.hasOwn(registeredScriptFiles, scriptName)) return json(res, 403, { ok: false, error: "Script is not registered" });

      const scriptFile = resolveRegisteredScriptFile(scriptName);
      if (!scriptFile) {
        return json(res, 404, {
          ok: false,
          error: `Registered script is not installed for ${scriptName}. Checked: ${registeredScriptFiles[scriptName].join(", ")}`
        });
      }

      target.deviceId = input.deviceId;
      target.serial = serial;
      const result = scriptName === "paymom"
        ? await startScriptDetached(scriptFile, target, input.args || {})
        : await runScript(scriptFile, target, input.args || {});
      return json(res, result.ok === false ? 400 : 200, result);
    }

    const action = String(input.action || "");
    if (action === "wake_screen") return json(res, 200, await wakeDevice(input.deviceId, target));

    const allowed = new Set([
      "device_info", "screen_state", "open_url", "launch_app", "dial_number",
      "home", "back", "recents", "notifications", "tap", "swipe",
      "scroll_down", "scroll_up", "click_text", "open_instagram_reels", "read_screen"
    ]);
    if (!allowed.has(action)) return json(res, 400, { ok: false, error: "Action not allowed" });

    const data = await sendToAndroid(input.deviceId, target, {
      deviceId: input.deviceId,
      action,
      args: input.args || {}
    });
    return json(res, data.ok === false ? 400 : 200, data);
  } catch (e) {
    return json(res, 503, { ok: false, error: e.message });
  }
});

server.on("error", error => {
  console.error(`[ADB] Bridge server error: ${error.message}`);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Jazz Windows ADB bridge listening on 127.0.0.1:${port}`);
  console.log(`ADB Wi-Fi auto-reconnect enabled; scan interval ${reconnectIntervalMs}ms`);
  console.log(`Approved Android scripts enabled from ${scriptRoot}`);
  reconnectLoop().catch(error => console.error("[ADB] Initial reconnect failed:", error.message));
  setInterval(() => reconnectLoop().catch(error => console.error("[ADB] Reconnect failed:", error.message)), reconnectIntervalMs);
});
