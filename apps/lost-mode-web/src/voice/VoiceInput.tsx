import React, { useEffect, useRef, useState } from "react";
import { Mic, RefreshCw, Square, Trash2, Volume2, X } from "lucide-react";
import { BrowserRecording, MAX_RECORDING_SECONDS, microphoneError, microphoneUnavailable, recordingToWav } from "./recording";
import "./voice-input.css";

type Props = {
  deviceName: string;
  disabled: boolean;
  onAction: (name: string, args: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
};

type PreparedVoice = { wav: Blob; url: string; audioBase64: string };

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function VoiceInput({ deviceName, disabled, onAction, onClose }: Props) {
  const [phase, setPhase] = useState<"idle" | "requesting" | "recording" | "processing" | "sending">("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [prepared, setPrepared] = useState<PreparedVoice | null>(null);
  const recording = useRef<BrowserRecording | null>(null);
  const objectUrl = useRef<string | null>(null);
  const mounted = useRef(true);

  function releasePrepared() {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setPrepared(null);
  }

  function cancelRecording() {
    recording.current?.cancel();
    recording.current = null;
  }

  function reset() {
    cancelRecording();
    releasePrepared();
    setPhase("idle");
    setSeconds(0);
    setError("");
    setNotice("");
  }

  useEffect(() => {
    mounted.current = true;
    const cleanup = () => {
      cancelRecording();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    };
    const visibility = () => { if (document.hidden) cleanup(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", cleanup);
    return () => {
      mounted.current = false;
      cleanup();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", cleanup);
    };
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.min(MAX_RECORDING_SECONDS, Math.floor((Date.now() - started) / 1000)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  function start() {
    if (phase !== "idle" || disabled) return;
    reset();
    setPhase("requesting");
    const capture = new BrowserRecording({
      onStarted: () => { if (mounted.current) setPhase("recording"); },
      onDone: blob => { void prepare(blob); },
      onError: err => {
        if (!mounted.current) return;
        recording.current = null;
        setPhase("idle");
        setError(microphoneError(err));
      },
    });
    recording.current = capture;
    void capture.start();
  }

  async function prepare(blob: Blob) {
    recording.current = null;
    if (!mounted.current) return;
    setPhase("processing");
    try {
      const wav = await recordingToWav(blob);
      if (wav.size > 900_000) throw new Error("Voice message is too large. Record a shorter message.");
      const audioBase64 = await blobToBase64(wav);
      const url = URL.createObjectURL(wav);
      if (!mounted.current) { URL.revokeObjectURL(url); return; }
      objectUrl.current = url;
      setPrepared({ wav, url, audioBase64 });
      setNotice(`Voice message ready for ${deviceName}. Preview it, then send it to the lost phone.`);
      setPhase("idle");
    } catch (err) {
      if (!mounted.current) return;
      setPhase("idle");
      setError(err instanceof Error ? err.message : "Could not prepare the voice message.");
    }
  }

  async function sendToLostPhone() {
    if (!prepared || disabled || phase !== "idle") return;
    setPhase("sending");
    setError("");
    setNotice(`Sending your voice securely to ${deviceName}…`);
    try {
      await onAction("PLAY_VOICE_MESSAGE", {
        mimeType: "audio/wav",
        audioBase64: prepared.audioBase64,
      });
      if (!mounted.current) return;
      setNotice(`Voice broadcast queued for ${deviceName}. The phone will play it through the recovery audio channel when it receives the command.`);
      setPhase("idle");
    } catch (err) {
      if (!mounted.current) return;
      setPhase("idle");
      setError(err instanceof Error ? err.message : "Could not send the voice broadcast.");
    }
  }

  const unavailable = microphoneUnavailable();
  const working = phase !== "idle";

  return <section id="recovery-voice-panel" className="voice-panel glass-panel" aria-labelledby="voice-title">
    <div className="voice-heading">
      <div><span className="eyebrow">REMOTE VOICE BROADCAST</span><h2 id="voice-title"><Volume2 size={21} /> Speak through lost phone</h2></div>
      <button type="button" className="secondary-button" onClick={onClose} aria-label="Close voice broadcast"><X size={18} /></button>
    </div>
    <p className="voice-description">Record your voice here, preview it, then send it to <strong>{deviceName}</strong>. The Android recovery app will play the recording loudly on that selected lost phone.</p>
    {unavailable && <p className="voice-hint">{unavailable}</p>}
    <div className="voice-record-controls">
      {phase === "recording" ? <button type="button" className="primary-button voice-stop" onClick={() => { setPhase("processing"); recording.current?.stop(); }}><Square size={17} /> Stop recording</button>
        : <button type="button" className="primary-button" disabled={!!unavailable || working || disabled} onClick={start}>
          {phase === "requesting" || phase === "processing" ? <RefreshCw className="spin" size={17} /> : <Mic size={17} />}
          {phase === "requesting" ? "Waiting for microphone…" : phase === "processing" ? "Preparing voice…" : "Record voice"}
        </button>}
      {(phase === "recording" || phase === "requesting") && <button type="button" className="secondary-button" onClick={reset}>Cancel</button>}
      <span className="voice-timer" role="timer">{seconds}s / {MAX_RECORDING_SECONDS}s</span>
    </div>
    <div className="voice-status" role="status" aria-live="polite">{phase === "recording" ? "Microphone on. Speak now…" : notice}</div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {prepared && <div className="voice-message-preview">
      <audio controls src={prepared.url} />
      <div className="voice-record-controls">
        <button type="button" className="primary-button" disabled={disabled || phase === "sending"} onClick={() => { void sendToLostPhone(); }}>
          {phase === "sending" ? <RefreshCw className="spin" size={17} /> : <Volume2 size={17} />} Play loudly on lost phone
        </button>
        <button type="button" className="secondary-button" disabled={phase === "sending"} onClick={reset}><Trash2 size={17} /> Discard</button>
      </div>
    </div>}
    <p className="voice-hint">This is a recovery broadcast, not speech-to-text. It does not use Whisper and it does not change your existing recovery buttons.</p>
  </section>;
}
