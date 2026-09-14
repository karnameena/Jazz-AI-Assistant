const targets = {
  "android-phone": {
    id: "android-phone",
    name: "Android Phone",
    kind: "android",
    url: process.env.JAZZ_ANDROID_PHONE_BRIDGE_URL || process.env.JAZZ_ANDROID_BRIDGE_URL || "",
    token: process.env.JAZZ_ANDROID_PHONE_BRIDGE_TOKEN || process.env.JAZZ_ANDROID_BRIDGE_TOKEN || ""
  },
  "android-tablet": {
    id: "android-tablet",
    name: "Android Tablet",
    kind: "android",
    url: process.env.JAZZ_ANDROID_TABLET_BRIDGE_URL || "",
    token: process.env.JAZZ_ANDROID_TABLET_BRIDGE_TOKEN || ""
  }
};

export const devices = Object.values(targets).map(device => ({
  id: device.id,
  name: device.name,
  kind: device.kind,
  status: device.url && device.token ? "configured" : "not-configured",
  bridge: Boolean(device.url && device.token)
}));

export function getDevice(id) {
  return devices.find(device => device.id === id) || null;
}

export async function sendAndroidCommand(deviceId, action, args = {}) {
  const target = targets[deviceId];
  const device = getDevice(deviceId);
  if (!device || !target) throw new Error("Unknown device");
  if (!target.url || !target.token) {
    return {
      ok: false,
      status: "bridge_not_configured",
      message: `${device.name} bridge is not configured. Set its bridge URL and token in the API environment.`
    };
  }

  const response = await fetch(`${target.url.replace(/\/$/, "")}/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${target.token}`
    },
    body: JSON.stringify({ deviceId, action, args })
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!response.ok) throw new Error(data?.error || `${device.name} bridge request failed`);
  return data;
}
