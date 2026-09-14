#!/usr/bin/env node
import http from "node:http";
import { execFile } from "node:child_process";

const port = Number(process.env.PORT || 9898);
const token = process.env.JAZZ_BRIDGE_TOKEN;
const host = process.env.HOST || "0.0.0.0";

if (!token) {
  console.error("Set JAZZ_BRIDGE_TOKEN before starting the bridge.");
  process.exit(1);
}

const ALLOWED_ACTIONS = new Set(["open_url", "launch_app", "speak", "device_info"]);

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.end(JSON.stringify(payload));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; if (raw.length > 64 * 1024) req.destroy(); });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch (error) { reject(error); }
    });
  });
}

function run(command, args = []) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr.trim() || error.message));
      resolve(stdout.trim());
    });
  });
}

async function execute(action, args = {}) {
  if (!ALLOWED_ACTIONS.has(action)) throw new Error("Action is not allowed by the bridge");

  if (action === "open_url") {
    const url = String(args.url || "").trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("Only http/https URLs are allowed");
    await run("termux-open-url", [url]);
    return { message: "URL opened", url };
  }

  if (action === "launch_app") {
    const packageName = String(args.packageName || "").trim();
    if (!/^[A-Za-z][A-Za-z0-9_.]+$/.test(packageName)) throw new Error("Invalid Android package name");
    await run("monkey", ["-p", packageName, "1"]);
    return { message: "Launch requested", packageName };
  }

  if (action === "speak") {
    const text = String(args.text || "").trim();
    if (!text || text.length > 500) throw new Error("Text must be 1-500 characters");
    await run("termux-tts-speak", [text]);
    return { message: "Speech requested" };
  }

  const model = await run("getprop", ["ro.product.model"]).catch(() => "unknown");
  const version = await run("getprop", ["ro.build.version.release"]).catch(() => "unknown");
  return { message: "Device information", model, androidVersion: version };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method !== "POST" || req.url !== "/command") return json(res, 404, { ok: false, error: "Not found" });

  const supplied = req.headers.authorization || "";
  if (supplied !== `Bearer ${token}`) return json(res, 401, { ok: false, error: "Unauthorized" });

  try {
    const input = await body(req);
    const result = await execute(String(input.action || ""), input.args);
    json(res, 200, { ok: true, ...result });
  } catch (error) {
    json(res, 400, { ok: false, error: error instanceof Error ? error.message : "Bridge command failed" });
  }
});

server.listen(port, host, () => console.log(`Jazz Android bridge listening on ${host}:${port}`));
