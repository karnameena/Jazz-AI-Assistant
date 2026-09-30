// Optional adapter to Jazz's existing Whisper /transcribe endpoint. This module
// never queues commands, changes the recovery allowlist, or stores recordings.
const MAX_WAV_BYTES = 44 + 31 * 16000 * 2;

function readAudio(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", data); req.off("end", end); req.off("error", error); req.off("aborted", aborted);
    };
    const error = err => { cleanup(); req.resume(); reject(err); };
    const aborted = () => error(Object.assign(new Error("Recording upload was cancelled."), { status: 400 }));
    const data = chunk => {
      size += chunk.length;
      if (size > MAX_WAV_BYTES) return error(Object.assign(new Error("Record a command of 30 seconds or less."), { status: 413 }));
      chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const timer = setTimeout(() => error(Object.assign(new Error("Recording upload timed out."), { status: 408 })), 10_000);
    req.on("data", data); req.on("end", end); req.on("error", error); req.on("aborted", aborted);
  });
}

export function validVoiceWav(audio) {
  return Buffer.isBuffer(audio) && audio.length > 44 && audio.length <= MAX_WAV_BYTES
    && audio.toString("ascii", 0, 4) === "RIFF"
    && audio.readUInt32LE(4) === audio.length - 8
    && audio.toString("ascii", 8, 12) === "WAVE"
    && audio.toString("ascii", 12, 16) === "fmt "
    && audio.readUInt32LE(16) === 16 && audio.readUInt16LE(20) === 1
    && audio.readUInt16LE(22) === 1 && audio.readUInt32LE(24) === 16000
    && audio.readUInt32LE(28) === 32000 && audio.readUInt16LE(32) === 2
    && audio.readUInt16LE(34) === 16 && audio.toString("ascii", 36, 40) === "data"
    && audio.readUInt32LE(40) === audio.length - 44 && audio.length % 2 === 0;
}

export function createVoiceHandler({ getSession, json, publicOrigin, sttUrl = process.env.LOST_MODE_STT_URL || "", fetchImpl = fetch }) {
  let endpoint = null;
  try {
    const url = new URL(sttUrl);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash) {
      endpoint = new URL(`${url.pathname.replace(/\/$/, "")}/transcribe`, url.origin).href;
    }
  } catch { /* Unconfigured voice must never prevent server startup. */ }
  let busy = false;
  const activeSession = req => {
    const session = getSession(req);
    // Compare ISO expiry as a timestamp, rather than against SQLite's differently
    // formatted CURRENT_TIMESTAMP string. This check is local to the new routes.
    return session && (!session.expires_at || Date.parse(session.expires_at) > Date.now()) ? session : null;
  };

  return async function voice(req, res, path) {
    const session = activeSession(req);
    if (!session) return json(res, 401, { ok: false, error: "Authentication required" });
    if (path === "/api/voice/config") return json(res, 200, { ok: true, enabled: Boolean(endpoint), maxSeconds: 30 });
    if ((req.headers.origin && req.headers.origin !== publicOrigin) || req.headers["sec-fetch-site"] === "cross-site") {
      return json(res, 403, { ok: false, error: "Voice input must come from the Lost Mode website." });
    }
    if (!endpoint) return json(res, 503, { ok: false, error: "Speech transcription is not configured. Use the recovery buttons or record an audio message." });
    if (String(req.headers["content-type"]).split(";")[0].trim() !== "audio/wav") {
      return json(res, 415, { ok: false, error: "Voice input requires WAV audio." });
    }
    if (Number(req.headers["content-length"] || 0) > MAX_WAV_BYTES) {
      return json(res, 413, { ok: false, error: "Record a command of 30 seconds or less." });
    }
    if (busy) return json(res, 429, { ok: false, error: "Speech transcription is busy. Please try again shortly." });
    busy = true;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.once("close", cancel);
    const timer = setTimeout(cancel, 95_000);
    try {
      const audio = await readAudio(req);
      if (!validVoiceWav(audio)) return json(res, 400, { ok: false, error: "Invalid recording. Please record your command again." });
      const upstream = await fetchImpl(endpoint, {
        method: "POST", headers: { "Content-Type": "audio/wav" }, body: audio,
        signal: controller.signal, redirect: "error",
      });
      if (!upstream.ok) throw new Error("Speech service unavailable");
      const data = await upstream.json();
      // Use what was actually spoken; broad assistant normalization may remove
      // words that matter for recovery (e.g. negation or a second instruction).
      const text = typeof data.rawText === "string" ? data.rawText.trim() : "";
      if (data.ok === false || !text || text.length > 500) {
        return json(res, 422, { ok: false, error: "No clear short command was recognized. Please try again." });
      }
      // A session may expire or be logged out while Whisper is running.
      if (!activeSession(req)) return json(res, 401, { ok: false, error: "Session expired. Log in again to use voice input." });
      return json(res, 200, { ok: true, text });
    } catch (error) {
      if (res.destroyed) return;
      return json(res, error.status || (controller.signal.aborted ? 504 : 503), {
        ok: false,
        error: error.status ? error.message : controller.signal.aborted
          ? "Speech transcription timed out. Try a shorter command."
          : "The Jazz speech service is unavailable. Use the recovery buttons and try voice again later.",
      });
    } finally {
      clearTimeout(timer); res.off("close", cancel); busy = false;
    }
  };
}
