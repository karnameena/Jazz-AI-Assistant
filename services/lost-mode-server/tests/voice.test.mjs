import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { hashSecret } from "../src/auth/password.mjs";
import { createVoiceHandler, validVoiceWav } from "../src/voice.mjs";
import { encodeWav } from "../../../apps/lost-mode-web/src/voice/recording.ts";

const wav = Buffer.from(await encodeWav(new Float32Array(1600)).arrayBuffer());
async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

test("reject truncated, oversized, stereo and incompatible WAV data", () => {
  assert.equal(validVoiceWav(wav), true);
  assert.equal(validVoiceWav(wav.subarray(0, 43)), false);
  assert.equal(validVoiceWav(wav.subarray(0, wav.length - 2)), false);
  const stereo = Buffer.from(wav); stereo.writeUInt16LE(2, 22);
  assert.equal(validVoiceWav(stereo), false);
  assert.equal(validVoiceWav(Buffer.alloc(2 * 1024 * 1024)), false);
});

test("unconfigured transcription stays optional and requires a session", async t => {
  const json = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  const handler = createVoiceHandler({ sttUrl: "", publicOrigin: "http://localhost:5190", getSession: req => req.headers.cookie === "test-session" ? {} : req.headers.cookie === "expired-session" ? { expires_at: new Date(Date.now() - 1000).toISOString() } : null, json });
  const server = http.createServer((req, res) => { void handler(req, res, new URL(req.url, "http://localhost").pathname); });
  const base = await listen(server);
  t.after(() => { server.closeAllConnections(); server.close(); });
  assert.equal((await fetch(`${base}/api/voice/config`)).status, 401);
  assert.equal((await fetch(`${base}/api/voice/config`, { headers: { Cookie: "expired-session" } })).status, 401);
  const response = await fetch(`${base}/api/voice/config`, { headers: { Cookie: "test-session" } });
  assert.equal((await response.json()).enabled, false);
  assert.equal((await fetch(`${base}/api/voice/transcribe`, { method: "POST", headers: { Cookie: "test-session" } })).status, 503);
});

test("authenticated voice integrates with existing server without queueing or changing actions", { timeout: 20000 }, async t => {
  let upstreamRequests = 0;
  let upstreamStatus = 200;
  let hold = null;
  let received = null;
  const stt = http.createServer(async (req, res) => {
    upstreamRequests++;
    assert.equal(req.url, "/transcribe");
    assert.equal(req.headers.cookie, undefined);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), wav);
    if (received) received();
    if (hold) await hold;
    res.writeHead(upstreamStatus, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, rawText: "Do not ring my phone", text: "ring my phone" }));
  });
  const sttBase = await listen(stt);
  t.after(() => { stt.closeAllConnections(); stt.close(); });
  const directory = mkdtempSync(join(tmpdir(), "jazz-voice-test-"));
  const dbPath = join(directory, "test.db");
  const db = new DatabaseSync(dbPath);
  db.exec(readFileSync(new URL("../migrations/001_initial.sql", import.meta.url), "utf8"));
  const password = "Test-Voice-Owner-123";
  db.prepare("INSERT INTO users(username,password_hash) VALUES(?,?)").run("voice-owner", hashSecret(password));
  db.prepare("INSERT INTO users(username,password_hash) VALUES(?,?)").run("other-owner", hashSecret(password));
  for (const [owner, name] of [[1, "phone"], [2, "other-phone"]]) {
    const result = db.prepare("INSERT INTO devices(user_id,device_id,device_name,credential_hash) VALUES(?,?,?,?)").run(owner, name, name, hashSecret("test-device-key"));
    db.prepare("INSERT INTO device_state(device_id) VALUES(?)").run(result.lastInsertRowid);
  }
  const portProbe = http.createServer();
  const base = await listen(portProbe);
  await new Promise(resolve => portProbe.close(resolve));
  const child = spawn(process.execPath, [new URL("../src/server.mjs", import.meta.url).pathname], {
    env: { ...process.env, PORT: new URL(base).port, LOST_MODE_DB_PATH: dbPath, LOST_MODE_STT_URL: sttBase, LOST_MODE_PUBLIC_ORIGIN: "http://localhost:5190", LOST_MODE_COOKIE_SECURE: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, "exit"); }
    db.close(); rmSync(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", bytes => { if (bytes.toString().includes("listening")) resolve(); });
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`Server exited: ${code}`)));
  });
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "voice-owner", password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const headers = { Cookie: cookie, "Content-Type": "audio/wav", Origin: "http://localhost:5190" };
  const post = (body = wav, extra = {}) => fetch(`${base}/api/voice/transcribe`, { method: "POST", headers: { ...headers, ...extra }, body });
  assert.equal((await fetch(`${base}/api/voice/transcribe`, { method: "POST", body: wav })).status, 401);
  assert.equal((await post(wav, { Origin: "https://unrelated.invalid" })).status, 403);
  assert.equal((await post(wav, { "Content-Type": "application/json" })).status, 415);
  assert.equal((await post(Buffer.alloc(1024 * 1024))).status, 413);
  assert.equal((await post(Buffer.from("not WAV"))).status, 400);
  assert.equal(upstreamRequests, 0);
  const transcribed = await post();
  assert.equal(transcribed.status, 200);
  assert.equal((await transcribed.json()).text, "Do not ring my phone", "raw words, including negation, are preserved");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM recovery_commands").get().n, 0, "transcription never queues actions");
  assert.equal(transcribed.headers.get("cache-control"), "no-store, max-age=0");
  upstreamStatus = 500;
  assert.equal((await post()).status, 503);
  upstreamStatus = 200;
  for (const [action, args, type] of [
    ["DEVICE_STATUS", {}, "device_status"], ["GET_LOCATION", {}, "device_location"],
    ["RING_DEVICE", {}, "ring_device"], ["RECOVERY_PHOTO", { camera: "front" }, "recovery_photo"],
    ["RECOVERY_PHOTO", { camera: "rear" }, "recovery_photo"], ["SET_RECOVERY_MODE", { enabled: true }, "set_recovery_mode"],
  ]) {
    const response = await fetch(`${base}/api/devices/1/actions`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action, args }) });
    assert.equal(response.status, 202);
    const command = db.prepare("SELECT * FROM recovery_commands WHERE id=?").get((await response.json()).commandId);
    assert.equal(command.type, type);
    if (args.camera) assert.equal(JSON.parse(command.args_json).camera, args.camera);
  }
  const actionRequest = { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "GET_LOCATION" }) };
  assert.equal((await fetch(`${base}/api/devices/2/actions`, actionRequest)).status, 404);
  assert.equal((await fetch(`${base}/api/devices/1/actions`, { ...actionRequest, body: JSON.stringify({ action: "SHELL" }) })).status, 400);

  let release;
  hold = new Promise(resolve => { release = resolve; });
  const arrived = new Promise(resolve => { received = resolve; });
  const inflight = post();
  await arrived;
  assert.equal((await post()).status, 429);
  await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
  release();
  assert.equal((await inflight).status, 401, "logged-out sessions cannot receive a pending transcript");
  assert.equal((await post()).status, 401);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});
