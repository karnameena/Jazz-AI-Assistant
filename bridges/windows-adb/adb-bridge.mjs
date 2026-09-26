import http from "node:http";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.JAZZ_ADB_BRIDGE_PORT || 9899);
const adb = process.env.ADB_PATH || "adb";
const reconnectIntervalMs = Number(process.env.JAZZ_ADB_RECONNECT_INTERVAL_MS || 10000);
const bridgeDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(bridgeDir, "../..");
const scriptRoot = resolve(process.env.JAZZ_SCRIPT_ROOT || join(repoRoot, "scripts", "android"));
const bashPath = process.env.JAZZ_BASH_PATH || "C:\\Program Files\\Git\\bin\\bash.exe";
const powershellPath = process.env.JAZZ_POWERSHELL_PATH || "powershell.exe";
const stateFile = join(bridgeDir, ".device-identities.json");

const targets = {
  "android-phone": {
    serial: process.env.JAZZ_ANDROID_PHONE_SERIAL || "",
    configuredSerial: process.env.JAZZ_ANDROID_PHONE_SERIAL || "",
    localPort: 19001,
    token: process.env.JAZZ_ANDROID_PHONE_TOKEN || ""
  },
  "android-tablet": {
    serial: process.env.JAZZ_ANDROID_TABLET_SERIAL || "",
    configuredSerial: process.env.JAZZ_ANDROID_TABLET_SERIAL || "",
    localPort: 19002,
    token: process.env.JAZZ_ANDROID_TABLET_TOKEN || ""
  }
};

const registeredScriptFiles = {
  unlock: ["unlockmobile.ps1"],
  unlockmobile: ["unlockmobile.ps1"],
  paymom: ["pay-mom.ps1", "Payto_Mom.ps1", "paymom.ps1", "paymom.sh"],
  instagram: ["instagram.ps1", "instagram.sh", "insta.sh"],
  youtube: ["youtube.ps1", "youtube.sh"],
  screenshot: ["screenshot.ps1", "screenshot.sh"]
};

const allowedActions = new Set([
  "device_info", "screen_state", "open_url", "launch_app", "launch_app_name", "open_app", "dial_number",
  "home", "back", "recents", "notifications", "tap", "swipe",
  "scroll_down", "scroll_up", "scroll_forward", "scroll_backward",
  "click_text", "long_click_text", "set_text", "type", "clear_text", "search_ui",
  "open_instagram_reels", "read_screen", "dump_ui_tree", "current_app",
  "speaker_on", "speaker_off",
  "whatsapp_search", "whatsapp_message", "execute_command"
]);

const safeCompanionRetryActions = new Set([
  "speaker_on", "speaker_off", "current_app", "read_screen", "dump_ui_tree"
]);

let identityState = {};
try {
  if (existsSync(stateFile)) identityState = JSON.parse(readFileSync(stateFile, "utf8"));
} catch {
  identityState = {};
}

function saveIdentityState() {
  try { writeFileSync(stateFile, JSON.stringify(identityState, null, 2), "utf8"); } catch {}
}

function sleep(ms) { return new Promise(resolvePromise => setTimeout(resolvePromise, ms)); }

function run(args, timeout = 15000) {
  return new Promise((resolvePromise, reject) => {
    execFile(adb, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim()));
      else resolvePromise(String(stdout || "").trim());
    });
  });
}

function isTcpSerial(serial) {
  return /^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(String(serial || ""));
}

function parseConnectedDevices(output) {
  return String(output || "")
    .split(/\r?\n/)
    .slice(1)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => ({ serial: line.split(/\s+/)[0], line }))
    .filter(item => /\sdevice(?:\s|$)/.test(item.line));
}

async function connectedDevices() {
  try { return parseConnectedDevices(await run(["devices", "-l"])); }
  catch { return []; }
}

async function isConnected(serial) {
  if (!serial) return false;
  return (await connectedDevices()).some(item => item.serial === serial);
}

async function physicalSerial(transport) {
  try { return await run(["-s", transport, "get-serialno"], 5000); }
  catch { return ""; }
}

async function rememberIdentity(deviceId, transport) {
  const serial = await physicalSerial(transport);
  if (serial && serial !== "unknown" && identityState[deviceId] !== serial) {
    identityState[deviceId] = serial;
    saveIdentityState();
  }
}

async function directReconnect(deviceId, target) {
  for (const endpoint of [...new Set([target.serial, target.configuredSerial].filter(isTcpSerial))]) {
    try {
      await run(["connect", endpoint], 8000).catch(() => "");
      await sleep(350);
      if (await isConnected(endpoint)) {
        target.serial = endpoint;
        await rememberIdentity(deviceId, endpoint);
        console.log(`[ADB] ${deviceId}: connected to ${endpoint}`);
        return true;
      }
    } catch {}
  }
  return false;
}

async function adoptExistingTransport(deviceId, target) {
  const devices = await connectedDevices();
  if (!devices.length) return false;

  const configured = devices.find(item => item.serial === target.configuredSerial);
  if (configured) {
    target.serial = configured.serial;
    await rememberIdentity(deviceId, configured.serial);
    return true;
  }

  const knownIdentity = identityState[deviceId] || "";
  if (knownIdentity) {
    for (const device of devices) {
      if ((await physicalSerial(device.serial)) === knownIdentity) {
        target.serial = device.serial;
        return true;
      }
    }
  }

  if (devices.length === 1) {
    target.serial = devices[0].serial;
    await rememberIdentity(deviceId, target.serial);
    console.log(`[ADB] ${deviceId}: adopted ${target.serial}`);
    return true;
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
  let output;
  try { output = await run(["mdns", "services"], 5000); }
  catch { return false; }

  const entries = output.split(/\r?\n/).map(parseMdnsEndpoint).filter(Boolean);
  const known = identityState[deviceId] || "";
  const candidates = known
    ? [...entries.filter(entry => entry.serviceName.includes(known)), ...entries]
    : entries;

  for (const entry of candidates) {
    try {
      await run(["connect", entry.endpoint], 8000).catch(() => "");
      await sleep(350);
      if (await isConnected(entry.endpoint)) {
        const serial = await physicalSerial(entry.endpoint);
        if (!known || !serial || serial === known || entries.length === 1) {
          target.serial = entry.endpoint;
          await rememberIdentity(deviceId, target.serial);
          console.log(`[ADB] ${deviceId}: recovered through mDNS at ${target.serial}`);
          return true;
        }
      }
    } catch {}
  }
  return false;
}

async function ensureConnected(deviceId, target) {
  if (target.serial && await isConnected(target.serial)) {
    await rememberIdentity(deviceId, target.serial);
    return target.serial;
  }
  if (target.configuredSerial && await isConnected(target.configuredSerial)) {
    target.serial = target.configuredSerial;
    await rememberIdentity(deviceId, target.serial);
    return target.serial;
  }
  if (await directReconnect(deviceId, target)) return target.serial;
  if (await adoptExistingTransport(deviceId, target)) return target.serial;
  if (await discoverAndReconnect(deviceId, target)) return target.serial;
  throw new Error(`${deviceId} is offline. Automatic ADB reconnect failed.`);
}

async function ensureForward(deviceId, target) {
  const serial = await ensureConnected(deviceId, target);
  await run(["-s", serial, "forward", `tcp:${target.localPort}`, "tcp:9898"]);
  return serial;
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

function resolveRegisteredScriptFile(scriptName) {
  const candidates = registeredScriptFiles[scriptName];
  if (!candidates) return null;
  const rootPrefix = `${scriptRoot}${process.platform === "win32" ? "\\" : "/"}`;
  for (const candidate of candidates) {
    const file = resolve(scriptRoot, basename(candidate));
    if (file.startsWith(rootPrefix) && existsSync(file)) return file;
  }
  return null;
}

function amountFromArgs(args = {}) {
  if (args?.amount !== null && args?.amount !== undefined && Number.isFinite(Number(args.amount))) return Number(args.amount);
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
    JAZZ_SCRIPT_ARGS: JSON.stringify({ ...args, amount })
  };
  if (amount !== null) env.JAZZ_PAYMENT_AMOUNT = String(amount);

  const extension = extname(file).toLowerCase();
  return {
    command: extension === ".ps1" ? powershellPath : bashPath,
    commandArgs: extension === ".ps1"
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file]
      : [file],
    env,
    amount
  };
}

function normalizeScriptResult(file, stdout) {
  const output = String(stdout || "").trim();
  const lastLine = output.split(/\r?\n/).filter(Boolean).pop() || "";
  try {
    const parsed = JSON.parse(lastLine);
    if (parsed && typeof parsed === "object") {
      return { ...parsed, ok: parsed.ok !== false, stdout: output, script: parsed.script || basename(file), executedScript: true };
    }
  } catch {}
  return { ok: true, message: output || `${basename(file)} completed.`, stdout: output, script: basename(file), executedScript: true };
}

function runScript(file, target, args = {}) {
  return new Promise((resolvePromise, reject) => {
    if (!file || !existsSync(file)) return reject(new Error("Script is not installed"));
    const { command, commandArgs, env } = buildScriptLaunch(file, target, args);
    console.log(`[ADB] Running ${basename(file)} on ${target.deviceId} via ${target.serial}`);
    execFile(command, commandArgs, { cwd: scriptRoot, env, timeout: 120000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[ADB] ${basename(file)} failed: ${String(stderr || stdout || error.message).trim()}`);
        return reject(new Error(String(stderr || stdout || error.message).trim()));
      }
      console.log(`[ADB] ${basename(file)} completed`);
      resolvePromise(normalizeScriptResult(file, stdout));
    });
  });
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

async function uiXml(serial) {
  await run(["-s", serial, "shell", "uiautomator", "dump", "/sdcard/jazz_bridge_ui.xml"], 8000);
  return run(["-s", serial, "shell", "cat", "/sdcard/jazz_bridge_ui.xml"], 8000);
}

function attr(tag, name) {
  return tag.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] || "";
}

function speakerNodeFromXml(xml) {
  const tags = String(xml || "").match(/<node\b[^>]*>/gi) || [];
  const candidates = tags.map(tag => {
    const text = attr(tag, "text");
    const desc = attr(tag, "content-desc");
    const id = attr(tag, "resource-id");
    const label = `${desc} ${text}`.trim().toLowerCase();
    const speakerLike = /^(?:speaker|speakerphone|handsfree)(?:\b|[, ])/i.test(label)
      || /(?:speaker|speakerphone)/i.test(id);
    if (!speakerLike) return null;
    const bounds = attr(tag, "bounds").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!bounds) return null;
    let state = null;
    if (/\b(?:speaker|speakerphone|handsfree)[, ]+(?:on|selected)\b/i.test(label)) state = true;
    else if (/\b(?:speaker|speakerphone|handsfree)[, ]+off\b/i.test(label)) state = false;
    else if (attr(tag, "checkable") === "true") state = attr(tag, "checked") === "true";
    else if (attr(tag, "selected") === "true") state = true;
    return {
      label,
      left: Number(bounds[1]), top: Number(bounds[2]), right: Number(bounds[3]), bottom: Number(bounds[4]),
      state
    };
  }).filter(Boolean);
  if (candidates.length === 1) return candidates[0];
  const exact = candidates.filter(item => /^(?:speaker|speakerphone|handsfree)(?:\s|$)/i.test(item.label));
  return exact.length === 1 ? exact[0] : null;
}

async function directSpeaker(deviceId, target, enabled) {
  const serial = await ensureConnected(deviceId, target);
  const before = speakerNodeFromXml(await uiXml(serial));
  if (!before) throw new Error("Speaker control is not visible on the current call screen.");
  if (before.state === enabled) {
    return { ok: true, status: enabled ? "SPEAKER_ALREADY_ON" : "SPEAKER_ALREADY_OFF", message: enabled ? "Mama, speaker is on." : "Mama, speaker is off.", deviceId };
  }
  const x = Math.round((before.left + before.right) / 2);
  const y = Math.round((before.top + before.bottom) / 2);
  await run(["-s", serial, "shell", "input", "tap", String(x), String(y)], 5000);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await sleep(250);
    const after = speakerNodeFromXml(await uiXml(serial).catch(() => ""));
    if (after?.state === enabled) {
      return { ok: true, status: enabled ? "SPEAKER_ON" : "SPEAKER_OFF", message: enabled ? "Mama, speaker is on." : "Mama, speaker is off.", deviceId };
    }
  }
  throw new Error("Speaker was tapped, but Jazz could not verify the new speaker state.");
}

async function sendViaDirectAdb(deviceId, target, payload) {
  const serial = await ensureConnected(deviceId, target);
  const action = String(payload?.action || "");
  const args = payload?.args || {};
  const ok = (message, extra = {}) => ({ ok: true, message, transport: "adb-direct-fallback", deviceId, ...extra });

  if (action === "speaker_on") return directSpeaker(deviceId, target, true);
  if (action === "speaker_off") return directSpeaker(deviceId, target, false);

  if (action === "launch_app") {
    const pkg = String(args.packageName || "");
    if (!/^[A-Za-z0-9._]+$/.test(pkg)) throw new Error("Invalid package name");
    await run(["-s", serial, "shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"], 15000);
    return ok("App launched through direct ADB", { packageName: pkg });
  }
  if (action === "home" || action === "back" || action === "recents" || action === "notifications") {
    const key = {
      home: "KEYCODE_HOME",
      back: "KEYCODE_BACK",
      recents: "KEYCODE_APP_SWITCH",
      notifications: "KEYCODE_NOTIFICATION"
    }[action];
    await run(["-s", serial, "shell", "input", "keyevent", key]);
    return ok(`${action} sent through direct ADB`);
  }
  if (action === "tap") {
    const x = Number(args.x); const y = Number(args.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Invalid tap coordinates");
    await run(["-s", serial, "shell", "input", "tap", String(Math.round(x)), String(Math.round(y))]);
    return ok("Tap sent through direct ADB");
  }
  if (action === "swipe") {
    const values = [args.x1, args.y1, args.x2, args.y2].map(Number);
    if (!values.every(Number.isFinite)) throw new Error("Invalid swipe coordinates");
    await run(["-s", serial, "shell", "input", "swipe", ...values.map(value => String(Math.round(value))), String(Math.round(Number(args.durationMs || 500)))]);
    return ok("Swipe sent through direct ADB");
  }
  if (["scroll_down", "scroll_up", "scroll_forward", "scroll_backward"].includes(action)) {
    const { width, height } = await screenSize(serial);
    const forward = action === "scroll_up" || action === "scroll_forward";
    const x = Math.round(width * 0.5);
    const fromY = Math.round(height * (forward ? 0.78 : 0.28));
    const toY = Math.round(height * (forward ? 0.28 : 0.78));
    await run(["-s", serial, "shell", "input", "swipe", String(x), String(fromY), String(x), String(toY), "420"]);
    return ok(action === "scroll_up" ? "Scrolled up through direct ADB" : action === "scroll_down" ? "Scrolled down through direct ADB" : "Scroll sent through direct ADB");
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
  if (action === "device_info") {
    const [model, manufacturer, version] = await Promise.all([
      run(["-s", serial, "shell", "getprop", "ro.product.model"], 5000),
      run(["-s", serial, "shell", "getprop", "ro.product.manufacturer"], 5000),
      run(["-s", serial, "shell", "getprop", "ro.build.version.release"], 5000)
    ]);
    return ok("Device info read through direct ADB", { model, manufacturer, androidVersion: version });
  }
  throw new Error(`Android companion is unavailable and ${action} requires Jazz Accessibility Service.`);
}

async function companionRequest(deviceId, target, payload) {
  await ensureForward(deviceId, target);
  const response = await fetch(`http://127.0.0.1:${target.localPort}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.token}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { ok: false, message: text }; }
  if (response.status === 401) {
    const error = new Error(data?.error || "Android Companion rejected bridge authentication.");
    error.noFallback = true;
    throw error;
  }
  if (typeof data === "object" && data !== null && Object.hasOwn(data, "ok")) return data;
  if (!response.ok) return { ok: false, error: data?.error || data?.message || `Android companion request failed (${response.status})` };
  return data;
}

async function sendToAndroid(deviceId, target, payload) {
  const retryable = safeCompanionRetryActions.has(String(payload?.action || ""));
  let companionError = null;
  const attempts = retryable ? 3 : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const data = await companionRequest(deviceId, target, payload);
      return data;
    } catch (error) {
      companionError = error instanceof Error ? error : new Error(String(error));
      if (companionError.noFallback) throw companionError;
      if (attempt + 1 < attempts) {
        await sleep(300 + attempt * 250);
        continue;
      }
    }
  }

  try {
    return await sendViaDirectAdb(deviceId, target, payload);
  } catch (fallbackError) {
    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    throw new Error(`${companionError?.message || "Android companion request failed"}. Direct ADB fallback also failed: ${fallbackMessage}`);
  }
}

async function reconnectLoop() {
  for (const [deviceId, target] of Object.entries(targets)) {
    try { await ensureConnected(deviceId, target); }
    catch {}
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

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 64 * 1024) req.destroy();
    });
    req.on("end", () => {
      try { resolvePromise(JSON.parse(raw || "{}")); }
      catch (error) { reject(error); }
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
      directReconnect: true,
      mdnsReconnect: true,
      scripts: true,
      powershellScripts: true,
      directAdbFallback: true,
      genericAccessibilityAutomation: true
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
    } catch (error) {
      return json(res, 500, { ok: false, error: error.message });
    }
  }

  if (req.method !== "POST" || !["/command", "/script"].includes(req.url)) {
    return json(res, 404, { ok: false, error: "Not found" });
  }

  try {
    const input = await readBody(req);
    const target = targets[input.deviceId];
    if (!target) return json(res, 404, { ok: false, error: "Unknown device" });
    const serial = await ensureConnected(input.deviceId, target);
    target.deviceId = input.deviceId;
    target.serial = serial;

    if (req.url === "/script") {
      const scriptName = String(input.scriptName || "");
      if (!/^[a-z0-9_-]+$/.test(scriptName)) return json(res, 400, { ok: false, error: "Invalid script name" });
      if (!Object.hasOwn(registeredScriptFiles, scriptName)) return json(res, 403, { ok: false, error: "Script is not registered" });
      const scriptFile = resolveRegisteredScriptFile(scriptName);
      if (!scriptFile) {
        return json(res, 404, { ok: false, error: `Registered script is not installed for ${scriptName}. Checked: ${registeredScriptFiles[scriptName].join(", ")}` });
      }
      const result = await runScript(scriptFile, target, input.args || {});
      return json(res, result.ok === false ? 400 : 200, result);
    }

    const action = String(input.action || "");
    if (action === "wake_screen") return json(res, 200, await wakeDevice(input.deviceId, target));
    if (!allowedActions.has(action)) return json(res, 400, { ok: false, error: "Action not allowed" });

    const data = await sendToAndroid(input.deviceId, target, {
      deviceId: input.deviceId,
      action,
      args: input.args || {}
    });
    return json(res, data.ok === false ? 400 : 200, data);
  } catch (error) {
    return json(res, 503, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

server.on("error", error => console.error(`[ADB] Bridge server error: ${error.message}`));

server.listen(port, "127.0.0.1", () => {
  console.log(`Jazz Windows ADB bridge listening on 127.0.0.1:${port}`);
  console.log(`ADB Wi-Fi auto-reconnect enabled; scan interval ${reconnectIntervalMs}ms`);
  console.log(`Generic Jazz Accessibility automation enabled through Android Companion`);
  console.log(`Approved Android scripts enabled from ${scriptRoot}`);
  reconnectLoop().catch(error => console.error("[ADB] Initial reconnect failed:", error.message));
  setInterval(() => reconnectLoop().catch(error => console.error("[ADB] Reconnect failed:", error.message)), reconnectIntervalMs);
});