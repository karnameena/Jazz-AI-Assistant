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

async function screenSize(serial) {
  try {
    const output = await run(["-s", serial, "shell", "wm", "size"], 5000);
    const matches = [...output.matchAll(/(\d+)x(\d+)/g)];
    const last = matches[matches.length - 1];
    if (last) return { width: Number(last[1]), height: Number(last[2]) };
  } catch {}
  return { width: 1080, height: 2400 };
}

async function sendViaDirectAdb(deviceId, target, payload) {
  const serial = await ensureConnected(deviceId, target);
  const action = String(payload?.action || "");
  const args = payload?.args || {};
  const ok = (message, extra = {}) => ({ ok: true, message, transport: "adb-direct-fallback", deviceId, ...extra });

  if (action === "launch_app") {
    const pkg = String(args.packageName || "");
    if (!/^[A-Za-z0-9._]+$/.test(pkg)) throw new Error("Invalid package name");
    await run(["-s", serial, "shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"], 15000);
    return ok("App launched through direct ADB", { packageName: pkg });
  }
  if (action === "home") {
    await run(["-s", serial, "shell", "input", "keyevent", "KEYCODE_HOME"]);
    return ok("Home opened through direct ADB");
  }
  if (action === "back") {
    await run(["-s", serial, "shell", "input", "keyevent", "KEYCODE_BACK"]);
    return ok("Back sent through direct ADB");
  }
  if (action === "recents") {
    await run(["-s", serial, "shell", "input", "keyevent", "KEYCODE_APP_SWITCH"]);
    return ok("Recents opened through direct ADB");
  }
  if (action === "notifications") {
    await run(["-s", serial, "shell", "input", "keyevent", "KEYCODE_NOTIFICATION"]);
    return ok("Notifications opened through direct ADB");
  }
  if (action === "tap") {
    const x = Number(args.x); const y = Number(args.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Invalid tap coordinates");
    await run(["-s", serial, "shell", "input", "tap", String(Math.round(x)), String(Math.round(y))]);
    return ok("Tap sent through direct ADB");
  }
  if (action === "swipe") {
    const x1 = Number(args.x1); const y1 = Number(args.y1); const x2 = Number(args.x2); const y2 = Number(args.y2);
    const duration = Number(args.durationMs || 500);
    if (![x1, y1, x2, y2, duration].every(Number.isFinite)) throw new Error("Invalid swipe coordinates");
    await run(["-s", serial, "shell", "input", "swipe", String(Math.round(x1)), String(Math.round(y1)), String(Math.round(x2)), String(Math.round(y2)), String(Math.round(duration))]);
    return ok("Swipe sent through direct ADB");
  }
  if (action === "scroll_down" || action === "scroll_up") {
    const { width, height } = await screenSize(serial);
    const x = Math.round(width * 0.5);
    const yTop = Math.round(height * 0.28);
    const yBottom = Math.round(height * 0.78);
    const fromY = action === "scroll_down" ? yBottom : yTop;
    const toY = action === "scroll_down" ? yTop : yBottom;
    await run(["-s", serial, "shell", "input", "swipe", String(x), String(fromY), String(x), String(toY), "420"]);
    return ok(action === "scroll_down" ? "Swiped up through direct ADB" : "Swiped down through direct ADB");
  }
  if (action === "open_url") {
    const url = String(args.url || "");
    if (!/^https?:\/\//i.test(url)) throw new Error("Invalid URL");
    await run(["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url], 15000);
    return ok("URL opened through direct ADB", { url });
  }
  if (action === "dial_number") {
    const number = String(args.number || "").replace(/[^0-9+]/g, "");
    if (number.length < 3) throw new Error("Invalid phone number");
    await run(["-s", serial, "shell", "am", "start", "-a", "android.intent.action.DIAL", "-d", `tel:${number}`], 15000);
    return ok("Dialer opened through direct ADB", { number });
  }
  if (action === "open_instagram_reels") {
    try {
      await run(["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "instagram://reels"], 15000);
    } catch {
      await run(["-s", serial, "shell", "monkey", "-p", "com.instagram.android", "-c", "android.intent.category.LAUNCHER", "1"], 15000);
    }
    return ok("Instagram Reels opened through direct ADB");
  }
  if (action === "device_info") {
    const [model, manufacturer, version] = await Promise.all([
      run(["-s", serial, "shell", "getprop", "ro.product.model"], 5000),
      run(["-s", serial, "shell", "getprop", "ro.product.manufacturer"], 5000),
      run(["-s", serial, "shell", "getprop", "ro.build.version.release"], 5000)
    ]);
    return ok("Device info read through direct ADB", { model, manufacturer, androidVersion: version });
  }

  throw new Error(`Android companion is unavailable and ${action} requires the companion Accessibility service.`);
}

async function sendToAndroid(deviceId, target, payload) {
  let companionError = null;
  try {
    await ensureForward(deviceId, target);
    const response = await fetch(`http://127.0.0.1:${target.localPort}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.token}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { message: text }; }
    if (response.ok && data?.ok !== false) return data;
    companionError = new Error(data?.error || data?.message || `Android companion request failed (${response.status})`);
  } catch (error) {
    companionError = error instanceof Error ? error : new Error(String(error));
  }

  try {
    const fallback = await sendViaDirectAdb(deviceId, target, payload);
    console.warn(`[ADB] Companion unavailable for ${payload?.action || "command"}; direct ADB fallback succeeded: ${companionError?.message || "unknown companion error"}`);
    return fallback;
  } catch (fallbackError) {
    const companionMessage = companionError?.message || "Android companion request failed";
    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    throw new Error(`${companionMessage}. Direct ADB fallback also failed: ${fallbackMessage}`);
  }
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
      powershellScripts: true,
      directAdbFallback: true
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
      const result = await runScript(scriptFile, target, input.args || {});
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
