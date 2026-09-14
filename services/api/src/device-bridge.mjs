const BRIDGE_URL = process.env.JAZZ_ANDROID_BRIDGE_URL || "";
const BRIDGE_TOKEN = process.env.JAZZ_ANDROID_BRIDGE_TOKEN || "";

export const devices = [
  { id: "android-phone", name: "Android Phone", kind: "android", status: "online", bridge: Boolean(BRIDGE_URL) },
  { id: "android-tablet", name: "Android Tablet", kind: "android", status: "online", bridge: Boolean(BRIDGE_URL) }
];

export function getDevice(id) {
  return devices.find(device => device.id === id) || null;
}

export async function sendAndroidCommand(deviceId, action, args = {}) {
  const device = getDevice(deviceId);
  if (!device) throw new Error("Unknown device");
  if (!BRIDGE_URL || !BRIDGE_TOKEN) {
    return {
      ok: false,
      status: "bridge_not_configured",
      message: "Android bridge is not configured. Start the authorized Termux bridge and set JAZZ_ANDROID_BRIDGE_URL/JAZZ_ANDROID_BRIDGE_TOKEN."
    };
  }

  const response = await fetch(`${BRIDGE_URL.replace(/\/$/, "")}/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BRIDGE_TOKEN}`
    },
    body: JSON.stringify({ deviceId, action, args })
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!response.ok) throw new Error(data?.error || "Android bridge request failed");
  return data;
}
