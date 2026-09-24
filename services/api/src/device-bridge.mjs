const windowsBridgeUrl = (process.env.JAZZ_ADB_BRIDGE_URL || "http://127.0.0.1:9899").replace(/\/$/, "");
const discoveryPollMs = Math.max(1500, Number(process.env.JAZZ_DEVICE_DISCOVERY_POLL_MS || 3000));

// Android serials/tokens belong to the Windows ADB bridge process.
// The API exposes only logical Jazz device IDs and live bridge/discovery state.
const targets = {
  "android-phone": { id: "android-phone", name: "Mobile", kind: "android", managedByBridge: true },
  "android-tablet": { id: "android-tablet", name: "Tablet", kind: "android", managedByBridge: true },
  "pc": { id: "pc", name: "PC", kind: "pc", managedByBridge: false },
  "tv": { id: "tv", name: "TV", kind: "tv", managedByBridge: false },
  "laptop": { id: "laptop", name: "Laptop", kind: "laptop", managedByBridge: false }
};

export const devices = Object.values(targets).map(device => ({
  id: device.id,
  name: device.name,
  kind: device.kind,
  status: device.managedByBridge ? "discovering" : "not-configured",
  bridge: device.managedByBridge,
  connected: false,
  serial: null,
  identity: null,
  lastSeen: null
}));

let refreshInFlight = null;

export function getDevice(id) {
  return devices.find(device => device.id === id) || null;
}

function setBridgeOffline() {
  for (const device of devices) {
    if (!device.bridge) continue;
    device.connected = false;
    device.status = "bridge-offline";
  }
}

export async function refreshBridgeDevices() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${windowsBridgeUrl}/devices`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(4500)
      });
      if (!response.ok) throw new Error(`ADB bridge discovery failed (${response.status})`);
      const data = await response.json();
      const bridgeTargets = data?.targets && typeof data.targets === "object" ? data.targets : {};
      const now = new Date().toISOString();

      for (const device of devices) {
        if (!device.bridge) continue;
        const state = bridgeTargets[device.id] || {};
        const connected = state.connected === true;
        device.connected = connected;
        device.status = connected ? "connected" : "offline";
        device.serial = state.serial || state.configuredSerial || null;
        device.identity = state.identity || null;
        if (connected) device.lastSeen = now;
      }
      return devices;
    } catch {
      setBridgeOffline();
      return devices;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function bridgePost(path, payload) {
  let response;
  try {
    response = await fetch(`${windowsBridgeUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    setBridgeOffline();
    throw new Error(`Windows ADB bridge is unavailable at ${windowsBridgeUrl}. Start the bridge and try again.`);
  }

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { data = { message: text }; }

  if (!response.ok) {
    throw new Error(data?.error || data?.message || "Windows ADB bridge request failed");
  }

  const device = getDevice(payload?.deviceId);
  if (device?.bridge) {
    device.connected = true;
    device.status = "connected";
    device.lastSeen = new Date().toISOString();
  }
  return data;
}

function requireBridgeManagedAndroid(deviceId) {
  const target = targets[deviceId];
  const device = getDevice(deviceId);
  if (!device || !target) throw new Error("Unknown device");
  if (!target.managedByBridge || target.kind !== "android") {
    throw new Error(`${device.name} is not configured for Android bridge control.`);
  }
  return { target, device };
}

export async function sendAndroidCommand(deviceId, action, args = {}) {
  requireBridgeManagedAndroid(deviceId);
  return bridgePost("/command", { deviceId, action, args });
}

export async function sendAndroidScript(deviceId, scriptName, args = {}) {
  requireBridgeManagedAndroid(deviceId);
  return bridgePost("/script", { deviceId, scriptName, args });
}

// Keep the exported device objects live so the existing /api/devices endpoint can
// continue returning the same array without introducing a second discovery system.
void refreshBridgeDevices();
const discoveryTimer = setInterval(() => {
  void refreshBridgeDevices();
}, discoveryPollMs);
discoveryTimer.unref?.();
