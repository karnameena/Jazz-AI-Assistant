const windowsBridgeUrl = process.env.JAZZ_ADB_BRIDGE_URL || "http://127.0.0.1:9899";
const targets = {
  "android-phone": { id: "android-phone", name: "Android Phone", kind: "android", serial: process.env.JAZZ_ANDROID_PHONE_SERIAL || "" },
  "android-tablet": { id: "android-tablet", name: "Android Tablet", kind: "android", serial: process.env.JAZZ_ANDROID_TABLET_SERIAL || "" }
};

export const devices = Object.values(targets).map(device => ({
  id: device.id,
  name: device.name,
  kind: device.kind,
  status: device.serial ? "configured" : "not-configured",
  bridge: Boolean(device.serial)
}));

export function getDevice(id) { return devices.find(device => device.id === id) || null; }

async function bridgePost(path, payload) {
  const response = await fetch(`${windowsBridgeUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!response.ok) throw new Error(data?.error || "Windows ADB bridge request failed");
  return data;
}

export async function sendAndroidCommand(deviceId, action, args = {}) {
  const target = targets[deviceId];
  const device = getDevice(deviceId);
  if (!device || !target) throw new Error("Unknown device");
  if (!target.serial) return { ok: false, status: "device_not_configured", message: `${device.name} serial is not configured.` };
  return bridgePost("/command", { deviceId, action, args });
}

export async function sendAndroidScript(deviceId, scriptName, args = {}) {
  const target = targets[deviceId];
  const device = getDevice(deviceId);
  if (!device || !target) throw new Error("Unknown device");
  if (!target.serial) return { ok: false, status: "device_not_configured", message: `${device.name} serial is not configured.` };
  return bridgePost("/script", { deviceId, scriptName, args });
}
