import test from "node:test";
import assert from "node:assert/strict";
import { resolveVoiceCommand } from "../src/voice/commands.ts";
import { BrowserRecording, encodeWav } from "../src/voice/recording.ts";

test("supported speech maps to existing actions and exact camera arguments", () => {
  const cases = [
    ["Hey Jazz, get device status.", "DEVICE_STATUS", {}],
    ["Please get my phone location!", "GET_LOCATION", {}],
    ["Where is my mobile?", "GET_LOCATION", {}],
    ["Hey Jazz, ring my phone", "RING_DEVICE", {}],
    ["Take a front-camera recovery photo", "RECOVERY_PHOTO", { camera: "front" }],
    ["Take a back-camera recovery photo", "RECOVERY_PHOTO", { camera: "rear" }],
    ["Request a rear camera photo", "RECOVERY_PHOTO", { camera: "rear" }],
    ["Enable lost mode", "SET_RECOVERY_MODE", { enabled: true }],
  ];
  for (const [phrase, action, args] of cases) {
    assert.equal(resolveVoiceCommand(phrase)?.action, action, phrase);
    assert.deepEqual(resolveVoiceCommand(phrase)?.args, args, phrase);
  }
});

test("unknown, negated, ambiguous and multi-command speech cannot dispatch", () => {
  for (const text of ["", "Do not ring my phone", "Don't enable lost mode", "Never take a front camera photo",
    "Get my location and ring my phone", "Ring my phone. Take a back camera photo.",
    "Can you tell me how to enable lost mode", "front and back camera", "front camera or back camera",
    "disable lost mode", "unlock mobile", "run powershell", "ring someone else's phone", "send audio to my phone"]) {
    assert.equal(resolveVoiceCommand(text), null, text);
  }
});

test("WAV encoder emits mono 16 kHz signed PCM compatible with Whisper", async () => {
  const audio = Buffer.from(await encodeWav(new Float32Array([-1, 0, 1, 3])).arrayBuffer());
  assert.equal(audio.toString("ascii", 0, 4), "RIFF");
  assert.equal(audio.readUInt32LE(24), 16000);
  assert.equal(audio.readUInt16LE(22), 1);
  assert.equal(audio.readUInt32LE(40), 8);
  assert.equal(audio.readInt16LE(44), -32768);
  assert.equal(audio.readInt16LE(46), 0);
  assert.equal(audio.readInt16LE(48), 32767);
  assert.equal(audio.readInt16LE(50), 32767);
});

test("closing while permission is pending stops a late microphone stream", async t => {
  let resolvePermission;
  let stopped = 0;
  const replace = (name, value) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
  };
  replace("window", { isSecureContext: true });
  replace("navigator", { mediaDevices: { getUserMedia: () => new Promise(resolve => { resolvePermission = resolve; }) } });
  replace("MediaRecorder", class { constructor() { assert.fail("Cancelled recording must not start"); } });
  const recording = new BrowserRecording({ onStarted: () => assert.fail("started"), onDone: () => assert.fail("done"), onError: error => assert.fail(String(error)) });
  const pending = recording.start();
  recording.cancel();
  resolvePermission({ getTracks: () => [{ stop: () => stopped++ }] });
  await pending;
  assert.equal(stopped, 1);
});
