import React, { useEffect, useRef, useState } from "react";
import { Check, Download, Mic, RefreshCw, Share2, Square, Trash2, X } from "lucide-react";
import { resolveVoiceCommand } from "./commands";
import { BrowserRecording, MAX_RECORDING_SECONDS, microphoneError, microphoneUnavailable, recordingToWav } from "./recording";
import "./voice-input.css";

type Props = {
  deviceName: string;
  disabled: boolean;
  onAction: (name: string, args: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
};

export function VoiceInput({ deviceName, disabled, onAction, onClose }: Props) {
  const [mode, setMode] = useState<"command" | "message">("command");
  const [phase, setPhase] = useState<"idle" | "requesting" | "recording" | "processing">("idle");
  const [availability, setAvailability] = useState<"checking" | "ready" | "unavailable">("checking");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState<{ file: File; url: string } | null>(null);
  const [sending, setSending] = useState(false);
  const recording = useRef<BrowserRecording | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const objectUrl = useRef<string | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const editor = useRef<HTMLTextAreaElement>(null);

  function releaseMessage() {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }

  function cancelWork() {
    generation.current++;
    recording.current?.cancel();
    recording.current = null;
    request.current?.abort();
    request.current = null;
  }

  function reset() {
    cancelWork();
    releaseMessage();
    setMessage(null);
    setTranscript("");
    setPhase("idle");
    setSeconds(0);
    setError("");
    setNotice("");
  }

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    fetch("/api/voice/config", { credentials: "include", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Voice input is unavailable. Check your session and try again.");
        return response.json();
      })
      .then(data => { if (!controller.signal.aborted) setAvailability(data.enabled ? "ready" : "unavailable"); })
      .catch(() => { if (!controller.signal.aborted) setAvailability("unavailable"); });
    const leavePage = () => {
      cancelWork();
      releaseMessage();
      if (mounted.current) {
        setMessage(null); setTranscript(""); setPhase("idle");
        setNotice("Voice input cleared when you left the page.");
      }
    };
    const visibility = () => { if (document.hidden) leavePage(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leavePage);
    return () => {
      mounted.current = false;
      controller.abort();
      cancelWork();
      releaseMessage();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leavePage);
    };
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const start = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.min(MAX_RECORDING_SECONDS, Math.floor((Date.now() - start) / 1000))), 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  async function finish(blob: Blob, current: number, capturedMode: typeof mode) {
    if (!mounted.current || generation.current !== current) return;
    recording.current = null;
    setPhase("processing");
    if (capturedMode === "message") {
      const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      const file = new File([blob], `jazz-audio-message-${Date.now()}.${ext}`, { type: blob.type });
      const url = URL.createObjectURL(file);
      objectUrl.current = url;
      setMessage({ file, url });
      setPhase("idle");
      setNotice("Message ready to preview. Choose Download or Share to keep or send it.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 100_000);
    try {
      const wav = await recordingToWav(blob);
      if (generation.current !== current || controller.signal.aborted) return;
      const response = await fetch("/api/voice/transcribe", {
        method: "POST", credentials: "include", signal: controller.signal,
        headers: { "Content-Type": "audio/wav" }, body: wav,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Transcription failed. Please try again.");
      if (generation.current !== current) return;
      setTranscript(data.text || "");
      setNotice("Review the transcript and selected device before confirming.");
      editor.current?.focus();
    } catch (err) {
      if (generation.current === current && mounted.current) {
        setError(controller.signal.aborted ? "Transcription timed out. Try a shorter recording or use the recovery buttons." : microphoneError(err));
      }
    } finally {
      window.clearTimeout(timeout);
      if (generation.current === current && mounted.current) { request.current = null; setPhase("idle"); }
    }
  }

  function start() {
    if (phase !== "idle" || disabled || submitting.current) return;
    reset();
    const current = generation.current;
    setPhase("requesting");
    const capture = new BrowserRecording({
      onStarted: () => { if (generation.current === current && mounted.current) setPhase("recording"); },
      onDone: blob => { void finish(blob, current, mode); },
      onError: err => {
        if (generation.current === current && mounted.current) {
          recording.current = null; setPhase("idle"); setError(microphoneError(err));
        }
      },
    });
    recording.current = capture;
    void capture.start();
  }

  const command = resolveVoiceCommand(transcript);
  const unavailable = microphoneUnavailable();
  const working = phase !== "idle";

  async function confirm() {
    if (!command || disabled || working || submitting.current) return;
    submitting.current = true;
    setSending(true);
    try {
      // The same action function as the six existing recovery buttons.
      await onAction(command.action, command.args);
      if (mounted.current) { setTranscript(""); setNotice("See recovery status below for the request result."); }
    } catch {
      if (mounted.current) setError("The recovery request could not be sent. Please try again.");
    } finally {
      submitting.current = false;
      if (mounted.current) setSending(false);
    }
  }

  async function shareMessage() {
    if (!message || !navigator.share || !navigator.canShare?.({ files: [message.file] })) return;
    try {
      await navigator.share({ files: [message.file], title: "Jazz recovery audio message" });
    } catch (err) {
      if (mounted.current && (err as DOMException)?.name !== "AbortError") setError("Could not share this recording. Use Download audio instead.");
    }
  }

  return <section id="recovery-voice-panel" className="voice-panel glass-panel" aria-labelledby="voice-title">
    <div className="voice-heading">
      <div><span className="eyebrow">OPTIONAL RECOVERY ACTION</span><h2 id="voice-title"><Mic size={21} /> Voice input</h2></div>
      <button type="button" className="secondary-button" onClick={onClose} aria-label="Close voice input"><X size={18} /></button>
    </div>
    <p className="voice-description">Use this browser’s microphone. Selected device: <strong>{deviceName}</strong>.</p>
    <div className="voice-modes" role="group" aria-label="Microphone purpose">
      <button type="button" aria-pressed={mode === "command"} disabled={sending} onClick={() => { reset(); setMode("command"); }}>Voice command</button>
      <button type="button" aria-pressed={mode === "message"} disabled={sending} onClick={() => { reset(); setMode("message"); }}>Audio message</button>
    </div>
    <p className="voice-description">{mode === "command"
      ? "Record one command, review the text, then confirm. Audio is transcribed by your configured Jazz speech service."
      : "Record a short message to preview, download, or share. It stays in this tab until you choose to share or download it."}</p>
    {mode === "command" && availability !== "ready" && <p className="voice-hint" role="status">{availability === "checking"
      ? "Checking voice availability…"
      : "Speech transcription is not configured. You can type a command below, record an audio message, or use the recovery buttons."}</p>}
    {unavailable && <p className="voice-hint">{unavailable}</p>}
    <div className="voice-record-controls">
      {phase === "recording" ? <button type="button" className="primary-button voice-stop" onClick={() => { setPhase("processing"); recording.current?.stop(); }}><Square size={17} /> Stop recording</button>
        : <button type="button" className="primary-button" disabled={!!unavailable || working || disabled || sending || (mode === "command" && availability !== "ready")} onClick={start}>
          {working ? <RefreshCw className="spin" size={17} /> : <Mic size={17} />} {phase === "requesting" ? "Waiting for microphone…" : phase === "processing" ? "Processing audio…" : "Start recording"}
        </button>}
      {working && <button type="button" className="secondary-button" onClick={reset}>Cancel</button>}
      <span className="voice-timer" role="timer" aria-label="Recording duration">{seconds}s / {MAX_RECORDING_SECONDS}s</span>
    </div>
    <div className="voice-status" role="status" aria-live="polite">{phase === "recording" ? "Microphone on. Recording…" : notice}</div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {mode === "command" && <>
      <label className="voice-transcript">Review or type a command
        <textarea ref={editor} value={transcript} disabled={working || sending} maxLength={500} rows={2} placeholder="Hey Jazz, get my phone location" onChange={event => { setTranscript(event.target.value); setNotice(""); }} />
      </label>
      {transcript.trim() && !command && <p className="voice-hint">No single supported command matched. Use one of the examples below.</p>}
      {command && <div className="voice-command-preview"><Check size={18} /><span><strong>{command.label}</strong> for <strong>{deviceName}</strong></span></div>}
      <div className="voice-record-controls">
        <button type="button" className="primary-button" disabled={!command || disabled || working || sending} onClick={() => { void confirm(); }}><Check size={17} /> Confirm command</button>
        <button type="button" className="secondary-button" disabled={sending || working || !transcript} onClick={reset}>Clear</button>
      </div>
      <details className="voice-examples"><summary>Supported commands</summary><ul>
        <li>“Get device status”</li><li>“Get my phone location”</li><li>“Ring my phone”</li>
        <li>“Take a front-camera recovery photo”</li><li>“Take a back-camera recovery photo”</li><li>“Enable lost mode”</li>
      </ul></details>
    </>}
    {mode === "message" && message && <div className="voice-message">
      <audio controls src={message.url} aria-label="Recorded audio message" />
      <div className="voice-record-controls">
        <a className="primary-button" href={message.url} download={message.file.name}><Download size={17} /> Download audio</a>
        {navigator.canShare?.({ files: [message.file] }) && <button type="button" className="secondary-button" onClick={() => { void shareMessage(); }}><Share2 size={17} /> Share audio</button>}
        <button type="button" className="secondary-button" onClick={reset}><Trash2 size={17} /> Discard</button>
      </div>
      <p className="voice-description">This message is not sent to or played on the lost device. Close the panel to discard it.</p>
    </div>}
  </section>;
}
