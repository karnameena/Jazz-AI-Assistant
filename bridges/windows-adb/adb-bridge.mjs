import http from "node:http";
import { execFile } from "node:child_process";

const port = Number(process.env.JAZZ_ADB_BRIDGE_PORT || 9899);
const adb = process.env.ADB_PATH || "adb";
const phoneSerial = process.env.JAZZ_ANDROID_PHONE_SERIAL || "";
const tabletSerial = process.env.JAZZ_ANDROID_TABLET_SERIAL || "";
const phoneToken = process.env.JAZZ_ANDROID_PHONE_TOKEN || "";
const tabletToken = process.env.JAZZ_ANDROID_TABLET_TOKEN || "";
const targets = {
  "android-phone": { serial: phoneSerial, localPort: 19001, token: phoneToken },
  "android-tablet": { serial: tabletSerial, localPort: 19002, token: tabletToken }
};

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(adb, args, { timeout: 15000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr.trim() || error.message));
      resolve(stdout.trim());
    });
  });
}

async function ensureForward(target) {
  if (!target.serial) throw new Error("Device serial is not configured");
  await run(["-s", target.serial, "forward", `tcp:${target.localPort}`, "tcp:9898"]);
}

async function sendToAndroid(target, payload) {
  await ensureForward(target);
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

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.end(JSON.stringify(data));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; if (raw.length > 64 * 1024) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (e) { reject(e); } });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, service: "jazz-adb-bridge" });
  if (req.method === "GET" && req.url === "/devices") {
    try { return json(res, 200, { ok: true, adb: await run(["devices", "-l"]) }); }
    catch (e) { return json(res, 500, { ok: false, error: e.message }); }
  }
  if (req.method !== "POST" || req.url !== "/command") return json(res, 404, { ok: false, error: "Not found" });
  try {
    const input = await body(req);
    const target = targets[input.deviceId];
    if (!target) return json(res, 404, { ok: false, error: "Unknown device" });
    const action = String(input.action || "");
    const allowed = new Set(["device_info", "open_url", "launch_app", "home", "back", "recents", "notifications", "tap", "swipe", "click_text", "read_screen"]);
    if (!allowed.has(action)) return json(res, 400, { ok: false, error: "Action not allowed" });
    const data = await sendToAndroid(target, { deviceId: input.deviceId, action, args: input.args || {} });
    return json(res, data.ok === false ? 400 : 200, data);
  } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
});

server.listen(port, "127.0.0.1", () => console.log(`Jazz Windows ADB bridge listening on 127.0.0.1:${port}`));
