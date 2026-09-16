const windowsBridgeUrl = process.env.JAZZ_ADB_BRIDGE_URL || "http://127.0.0.1:9899";

// Device identity/ADB serials belong to the Windows ADB bridge. The API only
// routes logical device IDs and must not require bridge-local secrets/config.
const targets = {
  "android-phone": { id: "android-phone", name: "Mobile", kind: "android", bridge: true },
  "android-tablet": { id: "android-tablet", name: "Tablet", kind: "android", bridge: true },
  "pc": { id: "pc", name: "PC", kind: "pc", bridge: false },
  "tv": { id: "tv", name: "TV", kind: "tv", bridge: false },
  "laptop": { id: "laptop", name: "Laptop", kind: "laptop", bridge: false }
};

export const devices = Object.values(targets).map(device => ({
  id: device.id,
  name: device.name,
  kind: device.kind,
  // Android configuration is resolved by the bridge at execution time.
  status: device.bridge ? "bridge-managed" : "available",
  bridge: device.bridge
}));

export function getDevice(id) { return devices.find(device => device.id === id) || null; }

async function bridgePost(path, payload) {
  let response;
  try {
    response = await fetch(`${windowsBridgeUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw new Error(`Windows ADB bridge is unavailable at ${windowsBridgeUrl}: ${error.message}`);
  }

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!response.ok) throw new Error(data?.error || data?.message || "Windows ADB bridge request failed");
  return data;
}

export async function sendAndroidCommand(deviceId, action, args = {}) {
  const target = targets[deviceId];
  const device = getDevice(deviceId);
  if (!device || !target || target.kind !== "android") throw new Error("Unknown Android device");
  return bridgePost("/command", { deviceId, action, args });
}

export async function sendAndroidScript(deviceId, scriptName, args = {}) {
  const target = targets[deviceId];
  const device = getDevice(deviceId);
  if (!device || !target || target.kind !== "android") throw new Error("Unknown Android device");
  return bridgePost("/script", { deviceId, scriptName, args });
}
