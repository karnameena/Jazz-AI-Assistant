import http from "node:http";

const port = Number(process.env.JAZZ_RECOVERY_LOCAL_PORT || 8799);
const relayUrl = String(process.env.JAZZ_RECOVERY_RELAY_URL || "").trim().replace(/\/$/, "");
const ownerToken = String(process.env.JAZZ_RECOVERY_OWNER_TOKEN || "").trim();
const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);

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

function ensureConfigured() {
  if (!relayUrl || !ownerToken) {
    throw new Error("Jazz recovery relay is not configured. Set JAZZ_RECOVERY_RELAY_URL and JAZZ_RECOVERY_OWNER_TOKEN in services/recovery-local/.env.");
  }
  if (!relayUrl.startsWith("https://")) {
    throw new Error("JAZZ_RECOVERY_RELAY_URL must use HTTPS.");
  }
}

async function relay(path, method = "GET", body = null) {
  ensureConfigured();
  const response = await fetch(`${relayUrl}${path}`, {
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
  if (!response.ok) throw new Error(data.error || data.message || `Recovery relay returned ${response.status}`);
  return data;
}

function parseRecoveryIntent(message) {
  const text = String(message || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return null;
  if (/\b(?:where is|where's|locate|find|send me)\b.{0,40}\b(?:my )?(?:mobile|phone)\b/.test(text) || /\bmobile location\b/.test(text) || /\bphone location\b/.test(text)) {
    return { type: "location" };
  }
  if (/\b(?:take|capture)\b.{0,40}\bfront(?:-camera| camera)?\b.{0,40}\b(?:recovery )?photo\b/.test(text)) {
    return { type: "camera", camera: "front" };
  }
  if (/\b(?:take|capture)\b.{0,40}\brear(?:-camera| camera)?\b.{0,40}\b(?:recovery )?photo\b/.test(text)) {
    return { type: "camera", camera: "rear" };
  }
  if (/\b(?:latest|last)\b.{0,30}\brecovery photo\b/.test(text) || /\bsend me\b.{0,30}\brecovery photo\b/.test(text)) {
    return { type: "photo" };
  }
  if (/\b(?:battery|battery level)\b/.test(text) && /\b(?:phone|mobile|lost)\b/.test(text)) {
    return { type: "status", focus: "battery" };
  }
  if (/\b(?:is|whether)\b.{0,25}\b(?:my )?(?:phone|mobile)\b.{0,25}\bonline\b/.test(text) || /\bphone online\b/.test(text)) {
    return { type: "status", focus: "online" };
  }
  if (/\bring\b.{0,25}\b(?:my )?(?:phone|mobile)\b/.test(text)) {
    return { type: "ring" };
  }
  if (/\benable\b.{0,30}\blost device mode\b/.test(text)) {
    return { type: "mode", enabled: true };
  }
  if (/\bdisable\b.{0,30}\blost device mode\b/.test(text)) {
    return { type: "mode", enabled: false };
  }
  if (/\b(?:lost phone|device recovery|recovery status|refresh recovery)\b/.test(text)) {
    return { type: "status" };
  }
  return null;
}

function statusAssistant(data, focus) {
  const online = data.online ? "online" : "offline";
  const status = data.status || {};
  if (focus === "battery") {
    if (typeof status.battery === "number" && status.battery >= 0) {
      return `Your phone battery is ${status.battery}%${status.charging ? " and charging" : ""}.`;
    }
    return "I don't have a recent battery reading from your phone yet.";
  }
  if (focus === "online") {
    return data.online
      ? `Your phone is online on ${status.network || "the network"}. Last contact: ${data.lastSeen || "just now"}.`
      : `Your phone is currently offline. Last seen: ${data.lastSeen || "unknown"}.`;
  }
  return `${data.deviceName || "Mama Android"} is ${online}. Battery: ${typeof status.battery === "number" ? `${status.battery}%` : "unknown"}. Network: ${status.network || "unknown"}. Recovery: ${data.mode || "NORMAL_MODE"}. Last seen: ${data.lastSeen || "unknown"}.`;
}

function locationPayload(data) {
  const result = data.result?.ok ? data.result : data.lastKnownLocation?.ok ? data.lastKnownLocation : data.lastKnownLocation || null;
  if (!result?.latitude && result?.latitude !== 0) return null;
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

async function executeIntent(intent) {
  if (intent.type === "status") {
    const data = await relay("/android/device/status");
    return { assistant: statusAssistant(data, intent.focus), recovery: { type: "status", data } };
  }
  if (intent.type === "location") {
    const data = await relay("/android/device/location");
    const location = locationPayload(data);
    if (!location) {
      return { assistant: data.message || "The phone has not returned a location yet. The request is queued for the paired Companion.", recovery: { type: "location", data } };
    }
    const freshness = location.status === "LIVE_LOCATION" ? "Location acquired" : "Last known location";
    return {
      assistant: `${freshness} with ±${Math.round(Number(location.accuracyMeters || 0))} m accuracy. [[JAZZ_RECOVERY_LOCATION]]${JSON.stringify(location)}`,
      recovery: { type: "location", data: location }
    };
  }
  if (intent.type === "ring") {
    const data = await relay("/android/device/ring", "POST", {});
    const result = data.result || {};
    return {
      assistant: data.completed
        ? (result.message || "Your registered phone is ringing.")
        : (data.message || "Ring command queued for your registered phone."),
      recovery: { type: "ring", data }
    };
  }
  if (intent.type === "mode") {
    const data = await relay("/android/device/recovery-mode", "POST", { enabled: intent.enabled });
    return {
      assistant: data.completed
        ? (data.result?.message || `Lost Device Mode ${intent.enabled ? "enabled" : "disabled"}.`)
        : (data.message || `Lost Device Mode ${intent.enabled ? "enable" : "disable"} command queued.`),
      recovery: { type: "mode", data }
    };
  }
  if (intent.type === "camera") {
    const data = await relay("/android/device/camera", "POST", { camera: intent.camera });
    if (data.completed && data.result?.ok === false) {
      return {
        assistant: data.result.message || data.result.error || "Android currently prevents recovery camera access in this device state.",
        recovery: { type: "camera", data }
      };
    }
    if (data.completed && data.result?.ok) {
      const photo = await relay("/android/device/recovery-photo");
      return {
        assistant: `Recovery photo captured from your registered phone. [[JAZZ_RECOVERY_PHOTO]]${JSON.stringify(photo)}`,
        recovery: { type: "photo", data: photo }
      };
    }
    return { assistant: data.message || "Recovery camera command queued for your registered phone.", recovery: { type: "camera", data } };
  }
  if (intent.type === "photo") {
    const photo = await relay("/android/device/recovery-photo");
    if (!photo.ok) return { assistant: "There is no recovery photo available yet.", recovery: { type: "photo", data: photo } };
    return {
      assistant: `Here is the latest recovery photo. [[JAZZ_RECOVERY_PHOTO]]${JSON.stringify(photo)}`,
      recovery: { type: "photo", data: photo }
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
      configured: Boolean(relayUrl && ownerToken),
      relayUrl: relayUrl || null
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

    if (req.method === "GET" && path === "/api/recovery/status") {
      const data = await relay("/android/device/status");
      return sendJson(req, res, 200, { ok: true, data });
    }
    if (req.method === "POST" && path === "/api/recovery/refresh") {
      const data = await relay("/android/device/refresh", "POST", {});
      return sendJson(req, res, 200, { ok: true, data });
    }
    if (req.method === "GET" && path === "/api/recovery/location") {
      const data = await relay("/android/device/location");
      return sendJson(req, res, 200, { ok: true, data, location: locationPayload(data) });
    }
    if (req.method === "POST" && path === "/api/recovery/ring") {
      const data = await relay("/android/device/ring", "POST", {});
      return sendJson(req, res, 200, { ok: true, data });
    }
    if (req.method === "POST" && path === "/api/recovery/camera") {
      const input = await parseJson(req);
      const data = await relay("/android/device/camera", "POST", { camera: input.camera === "rear" ? "rear" : "front" });
      let photo = null;
      if (data.completed && data.result?.ok) photo = await relay("/android/device/recovery-photo");
      return sendJson(req, res, 200, { ok: true, data, photo });
    }
    if (req.method === "GET" && path === "/api/recovery/photo") {
      const data = await relay("/android/device/recovery-photo");
      return sendJson(req, res, 200, { ok: true, data });
    }
    if (req.method === "POST" && path === "/api/recovery/mode") {
      const input = await parseJson(req);
      const data = await relay("/android/device/recovery-mode", "POST", { enabled: input.enabled !== false });
      return sendJson(req, res, 200, { ok: true, data });
    }

    return sendJson(req, res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    return sendJson(req, res, 503, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[Jazz Recovery Local] listening on 127.0.0.1:${port}`);
  console.log(`[Jazz Recovery Local] relay=${relayUrl || "NOT CONFIGURED"}`);
});
