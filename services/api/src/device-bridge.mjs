const windowsBridgeUrl = process.env.JAZZ_ADB_BRIDGE_URL || "http://127.0.0.1:9899";

// Android serials/tokens belong to the Windows ADB bridge process.
// The API only needs a logical device id and the bridge URL.
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
  status: device.managedByBridge ? "bridge-managed" : "not-configured",
  bridge: device.managedByBridge
}));

export function getDevice(id) {
  return devices.find(device => device.id === id) || null;
}

async function bridgePost(path, payload) {
  let response;
  try {
    response = await fetch(`${windowsBridgeUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error(`Windows ADB bridge is unavailable at ${windowsBridgeUrl}. Start the bridge and try again.`);
  }

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { data = { message: text }; }

  if (!response.ok) {
    throw new Error(data?.error || data?.message || "Windows ADB bridge request failed");
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
