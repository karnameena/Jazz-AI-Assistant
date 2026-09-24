import http from "node:http";

const port = Number(process.env.JAZZ_RECOVERY_LOCAL_PORT || 8799);
const relayUrl = String(process.env.JAZZ_RECOVERY_RELAY_URL || "").trim().replace(/\/$/, "");
const localRelayUrl = String(process.env.JAZZ_RECOVERY_LOCAL_RELAY_URL || "http://127.0.0.1:8788").trim().replace(/\/$/, "");
const ownerToken = String(process.env.JAZZ_RECOVERY_OWNER_TOKEN || "").trim();
const allowedOrigins = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);

function sendJson(req, res, status, payload) {
  const origin = String(req.headers.origin || "");
  if (allowedOrigins.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function parseJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
  });
}

function validLocalRelay(value) {
  return /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/i.test(String(value || ""));
}

function ensureConfigured() {
  if (!ownerToken) throw new Error("Jazz recovery owner authorization is not configured.");
  if (relayUrl && !relayUrl.startsWith("https://")) throw new Error("JAZZ_RECOVERY_RELAY_URL must use HTTPS.");
  if (localRelayUrl && !validLocalRelay(localRelayUrl)) throw new Error("JAZZ_RECOVERY_LOCAL_RELAY_URL must point to localhost only.");
  if (!relayUrl && !localRelayUrl) throw new Error("No Jazz recovery relay is configured.");
}

function relayCandidates() {
  return [...new Set([relayUrl, localRelayUrl].filter(Boolean))];
}

async function relayRequest(baseUrl, path, method = "GET", body = null) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(35_000)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text || "{}"); }
  catch { data = { ok: false, error: text || `Relay returned ${response.status}` }; }
  return { response, data };
}

async function relay(path, method = "GET", body = null) {
  ensureConfigured();
  const candidates = relayCandidates();
  let lastError = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const baseUrl = candidates[index];
    try {
      const { response, data } = await relayRequest(baseUrl, path, method, body);
      if (response.ok) return data;
      const message = data.error || data.message || `Recovery relay returned ${response.status}`;
      lastError = new Error(message);
      if (response.status === 401 || response.status === 403) throw lastError;
      if (index === candidates.length - 1) throw lastError;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (index === candidates.length - 1) break;
      console.warn(`[Jazz Recovery Local] ${baseUrl} unavailable (${lastError.message}); trying ${candidates[index + 1]}.`);
    }
  }
  throw new Error(lastError?.message || "Recovery relay is unavailable.");
}

function parseRecoveryIntent(message) {
  const text = String(message || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return null;
  if (/\b(?:where is|where's|locate|find|send me)\b.{0,40}\b(?:my )?(?:mobile|phone)\b/.test(text) || /\b(?:mobile|phone) location\b/.test(text)) return { type: "location" };
  if (/\b(?:take|capture)\b.{0,40}\bfront(?:-camera| camera)?\b.{0,40}\b(?:recovery )?photo\b/.test(text)) return { type: "camera", camera: "front" };
  if (/\b(?:take|capture)\b.{0,40}\brear(?:-camera| camera)?\b.{0,40}\b(?:recovery )?photo\b/.test(text)) return { type: "camera", camera: "rear" };
  if (/\b(?:latest|last|send me)\b.{0,30}\brecovery photo\b/.test(text)) return { type: "photo" };
  if (/\b(?:battery|battery level)\b/.test(text) && /\b(?:phone|mobile|lost)\b/.test(text)) return { type: "status", focus: "battery" };
  if (/\b(?:is|whether)\b.{0,25}\b(?:my )?(?:phone|mobile)\b.{0,25}\bonline\b/.test(text) || /\bphone online\b/.test(text)) return { type: "status", focus: "online" };
  if (/\bring\b.{0,25}\b(?:my )?(?:phone|mobile)\b/.test(text)) return { type: "ring" };
  if (/\benable\b.{0,30}\blost device mode\b/.test(text)) return { type: "mode", enabled: true };
  if (/\bdisable\b.{0,30}\blost device mode\b/.test(text)) return { type: "mode", enabled: false };
  if (/\b(?:lost phone|device recovery|recovery status|refresh recovery)\b/.test(text)) return { type: "status" };
  return null;
}

function accessibilityGuidance(status = {}) {
  if (status.accessibilityHealth === "MANUAL_REENABLE_REQUIRED") {
    return " Jazz Accessibility Service is disabled; Android does not allow apps to silently re-enable Accessibility, so re-enable Jazz Accessibility Service in Android Accessibility settings when you regain access to the phone.";
  }
  if (status.accessibilityHealth === "ENABLED_BUT_NOT_CONNECTED") {
    return " Jazz Accessibility Service is enabled but not currently connected; Android should reconnect it automatically. If it does not, open Accessibility settings and toggle Jazz off/on.";
  }
  return "";
}

function statusAssistant(data, focus) {
  const status = data.status || {};
  if (focus === "battery") {
    return typeof status.battery === "number" && status.battery >= 0
      ? `Your phone battery is ${status.battery}%${status.charging ? " and charging" : ""}.`
      : "I don't have a recent battery reading from your phone yet.";
  }
  if (focus === "online") {
    return data.online
      ? `Your phone is online on ${status.network || "the network"}. Last contact: ${data.lastSeen || "just now"}.`
      : `Your phone is offline or has no reachable internet. Last seen: ${data.lastSeen || "unknown"}.${accessibilityGuidance(status)}`;
  }
  return `${data.deviceName || "Mama Android"} is ${data.online ? "online" : "offline"}. Battery: ${typeof status.battery === "number" ? `${status.battery}%` : "unknown"}. Network: ${status.network || "unknown"}. Recovery: ${data.mode || "NORMAL_MODE"}. Last seen: ${data.lastSeen || "unknown"}.${accessibilityGuidance(status)}`;
}

function unreachableMessage(status) {
  const snapshot = status?.status || {};
  if (!status?.lastSeen) return "The Android Companion has not reached the recovery relay yet. Check the phone's recovery server URL and internet permission/setup.";
  if (snapshot.network === "OFFLINE" || snapshot.online === false) return `The phone is currently unreachable because it has no validated internet connection. Last seen: ${status.lastSeen}. Jazz will retry automatically when Wi-Fi or mobile data returns.`;
  return `The phone is not responding to recovery commands right now. Last seen: ${status.lastSeen}. Android may be in Doze, background-restricted, powered off, or temporarily without internet. Jazz recovery will keep retrying safely.`;
}

async function currentStatus() {
  return relay("/android/device/status");
}

async function ensureReachable() {
  const status = await currentStatus();
  return { status, reachable: status.online === true };
}

function locationPayload(data) {
  const result = data.result?.ok ? data.result : data.lastKnownLocation?.ok ? data.lastKnownLocation : data.lastKnownLocation || null;
  if (!result || (result.latitude === undefined && result.latitude !== 0)) return null;
  return {
    latitude: result.latitude,
    longitude: result.longitude,
    accuracyMeters: result.accuracyMeters,
    provider: result.provider,
    timestamp: result.timestamp,
    status: result.status || (data.completed ? "LIVE_LOCATION" : "LAST_KNOWN_LOCATION"),
    battery: result.statusSnapshot?.battery,
    network: result.statusSnapshot?.network
  };
}

function photoMarker(photo) {
  return {
    deviceId: photo?.deviceId || null,
    deviceName: photo?.deviceName || "Mama Android",
    camera: photo?.camera || "front",
    timestamp: photo?.timestamp || null,
    available: Boolean(photo?.ok)
  };
}

async function executeIntent(intent) {
  if (intent.type === "status") {
    const data = await currentStatus();
    return { assistant: statusAssistant(data, intent.focus), recovery: { type: "status", data } };
  }

  if (intent.type === "photo") {
    const photo = await relay("/android/device/recovery-photo");
    return photo.ok
      ? { assistant: `Here is the latest recovery photo. [[JAZZ_RECOVERY_PHOTO]]${JSON.stringify(photoMarker(photo))}`, recovery: { type: "photo", data: photoMarker(photo) } }
      : { assistant: "There is no recovery photo available yet.", recovery: { type: "photo", data: photoMarker(photo) } };
  }

  const health = await ensureReachable();
  if (!health.reachable) {
    if (intent.type === "location" && health.status.lastKnownLocation) {
      const location = locationPayload({ lastKnownLocation: health.status.lastKnownLocation, completed: false });
      if (location) {
        return {
          assistant: `${unreachableMessage(health.status)} Showing the last known location. [[JAZZ_RECOVERY_LOCATION]]${JSON.stringify(location)}`,
          recovery: { type: "location", data: location }
        };
      }
    }
    return { assistant: unreachableMessage(health.status), recovery: { type: intent.type, data: health.status } };
  }

  if (intent.type === "location") {
    const data = await relay("/android/device/location");
    const location = locationPayload(data);
    if (!location) return { assistant: unreachableMessage(await currentStatus()), recovery: { type: "location", data } };
    const freshness = location.status === "LIVE_LOCATION" ? "Location acquired" : "Last known location";
    return {
      assistant: `${freshness} with ±${Math.round(Number(location.accuracyMeters || 0))} m accuracy. [[JAZZ_RECOVERY_LOCATION]]${JSON.stringify(location)}`,
      recovery: { type: "location", data: location }
    };
  }

  if (intent.type === "ring") {
    const data = await relay("/android/device/ring", "POST", {});
    if (!data.completed) return { assistant: unreachableMessage(await currentStatus()), recovery: { type: "ring", data } };
    return { assistant: data.result?.message || "Your registered phone is ringing.", recovery: { type: "ring", data } };
  }

  if (intent.type === "mode") {
    const data = await relay("/android/device/recovery-mode", "POST", { enabled: intent.enabled });
    if (!data.completed) return { assistant: unreachableMessage(await currentStatus()), recovery: { type: "mode", data } };
    return { assistant: data.result?.message || `Lost Device Mode ${intent.enabled ? "enabled" : "disabled"}.`, recovery: { type: "mode", data } };
  }

  if (intent.type === "camera") {
    const data = await relay("/android/device/camera", "POST", { camera: intent.camera });
    if (!data.completed) return { assistant: unreachableMessage(await currentStatus()), recovery: { type: "camera", data } };
    if (data.result?.ok === false) {
      return { assistant: data.result.message || data.result.error || "Android blocked recovery camera access in the current device state.", recovery: { type: "camera", data } };
    }
    const photo = await relay("/android/device/recovery-photo");
    return {
      assistant: `Recovery photo captured from your registered phone. [[JAZZ_RECOVERY_PHOTO]]${JSON.stringify(photoMarker(photo))}`,
      recovery: { type: "photo", data: photoMarker(photo) }
    };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return sendJson(req, res, 204, {});
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/health") {
    return sendJson(req, res, 200, {
      ok: true,
      service: "jazz-recovery-local",
      configured: Boolean(ownerToken && (relayUrl || localRelayUrl)),
      relayUrl: relayUrl || null,
      localRelayUrl: localRelayUrl || null,
      localhostFallback: Boolean(localRelayUrl)
    });
  }

  try {
    if (req.method === "POST" && path === "/api/recovery/chat") {
      const input = await parseJson(req);
      const intent = parseRecoveryIntent(input.message);
      if (!intent) return sendJson(req, res, 200, { ok: true, recognized: false });
      const result = await executeIntent(intent);
      return sendJson(req, res, 200, { ok: true, recognized: true, intent, ...result });
    }
    if (req.method === "GET" && path === "/api/recovery/status") return sendJson(req, res, 200, { ok: true, data: await currentStatus() });
    if (req.method === "POST" && path === "/api/recovery/refresh") return sendJson(req, res, 200, { ok: true, data: await relay("/android/device/refresh", "POST", {}) });
    if (req.method === "GET" && path === "/api/recovery/location") {
      const health = await ensureReachable();
      if (!health.reachable) return sendJson(req, res, 200, { ok: true, reachable: false, diagnosis: unreachableMessage(health.status), data: health.status, location: locationPayload({ lastKnownLocation: health.status.lastKnownLocation }) });
      const data = await relay("/android/device/location");
      return sendJson(req, res, 200, { ok: true, reachable: true, data, location: locationPayload(data) });
    }
    if (req.method === "POST" && path === "/api/recovery/ring") return sendJson(req, res, 200, { ok: true, data: await relay("/android/device/ring", "POST", {}) });
    if (req.method === "POST" && path === "/api/recovery/camera") {
      const input = await parseJson(req);
      const data = await relay("/android/device/camera", "POST", { camera: input.camera === "rear" ? "rear" : "front" });
      let photo = null;
      if (data.completed && data.result?.ok) photo = await relay("/android/device/recovery-photo");
      return sendJson(req, res, 200, { ok: true, data, photo: photo ? photoMarker(photo) : null });
    }
    if (req.method === "GET" && path === "/api/recovery/photo") return sendJson(req, res, 200, { ok: true, data: await relay("/android/device/recovery-photo") });
    if (req.method === "POST" && path === "/api/recovery/mode") {
      const input = await parseJson(req);
      return sendJson(req, res, 200, { ok: true, data: await relay("/android/device/recovery-mode", "POST", { enabled: input.enabled !== false }) });
    }
    return sendJson(req, res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    return sendJson(req, res, 503, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[Jazz Recovery Local] listening on 127.0.0.1:${port}`);
  console.log(`[Jazz Recovery Local] relay=${relayUrl || "NOT CONFIGURED"}, localhost fallback=${localRelayUrl || "DISABLED"}`);
});
