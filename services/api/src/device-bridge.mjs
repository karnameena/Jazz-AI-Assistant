import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const windowsBridgeUrl = process.env.JAZZ_ADB_BRIDGE_URL || "http://127.0.0.1:9899";
const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const unlockMobileScript = resolve(repoRoot, "scripts", "android", "unlockmobile.ps1");
const powershell = process.env.JAZZ_POWERSHELL_PATH || "powershell.exe";

// Android serials/tokens belong to the Windows ADB bridge process.
// The API only needs a logical device id and the bridge URL. This avoids
// requiring JAZZ_ANDROID_PHONE_SERIAL in two different .env files/processes.
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
  } catch (error) {
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

function runUnlockMobilePowerShell(deviceId) {
  return new Promise((resolvePromise, reject) => {
    execFile(
      powershell,
      [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", unlockMobileScript,
        "-BridgeUrl", windowsBridgeUrl,
        "-DeviceId", deviceId
      ],
      { cwd: repoRoot, windowsHide: true, timeout: 30000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || stdout || error.message).trim()));
          return;
        }

        const output = String(stdout || "").trim();
        if (!output) {
          resolvePromise({
            ok: true,
            status: "authentication_required",
            message: "Mobile is awake. Authenticate on the device, then Jazz can continue.",
            deviceId,
            script: "unlockmobile.ps1",
            executedScript: true
          });
          return;
        }

        try {
          resolvePromise(JSON.parse(output.split(/\r?\n/).pop()));
        } catch {
          resolvePromise({
            ok: true,
            status: "authentication_required",
            message: output,
            deviceId,
            script: "unlockmobile.ps1",
            executedScript: true
          });
        }
      }
    );
  });
}

export async function sendAndroidCommand(deviceId, action, args = {}) {
  requireBridgeManagedAndroid(deviceId);
  return bridgePost("/command", { deviceId, action, args });
}

export async function sendAndroidScript(deviceId, scriptName, args = {}) {
  requireBridgeManagedAndroid(deviceId);

  if (scriptName === "unlockmobile") {
    return runUnlockMobilePowerShell(deviceId);
  }

  return bridgePost("/script", { deviceId, scriptName, args });
}
