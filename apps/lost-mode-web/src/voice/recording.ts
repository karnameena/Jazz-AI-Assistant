export const MAX_RECORDING_SECONDS = 20;
const MAX_RECORDING_BYTES = 2 * 1024 * 1024;

export function microphoneUnavailable(): string | null {
  if (!window.isSecureContext) return "Open Lost Mode over HTTPS (or localhost) to use the microphone.";
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    return "Microphone recording is unavailable in this browser. Recovery buttons still work.";
  }
  return null;
}

export function microphoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "Microphone permission was denied. Allow it in your browser settings and try again.";
    if (error.name === "NotFoundError") return "No microphone was found on this device.";
    if (error.name === "NotReadableError") return "The microphone is busy or unavailable. Close other recording apps and try again.";
  }
  return error instanceof Error ? error.message : "Microphone recording failed. Please try again.";
}

type RecordingCallbacks = {
  onStarted: () => void;
  onDone: (blob: Blob) => void;
  onError: (error: unknown) => void;
};

export class BrowserRecording {
  private cancelled = false;
  private stopping = false;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chunks: Blob[] = [];
  private bytes = 0;
  private callbacks: RecordingCallbacks;

  constructor(callbacks: RecordingCallbacks) { this.callbacks = callbacks; }

  async start() {
    try {
      const unavailable = microphoneUnavailable();
      if (unavailable) throw new Error(unavailable);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: true, noiseSuppression: true,
      } });
      if (this.cancelled) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.stream = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
        .find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.recorder = recorder;
      recorder.ondataavailable = event => {
        if (this.cancelled || !event.data.size) return;
        this.bytes += event.data.size;
        if (this.bytes > MAX_RECORDING_BYTES) {
          this.cancel();
          this.callbacks.onError(new Error("The recording is too large. Please record a shorter message."));
          return;
        }
        this.chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (this.cancelled) return;
        this.cancel();
        this.callbacks.onError(new Error("Recording was interrupted. Please try again."));
      };
      recorder.onstop = () => {
        this.releaseTracks();
        if (this.cancelled) return;
        const blob = new Blob(this.chunks, { type: recorder.mimeType || this.chunks[0]?.type || "audio/webm" });
        this.chunks = [];
        if (!blob.size) this.callbacks.onError(new Error("No audio was recorded. Please try again."));
        else this.callbacks.onDone(blob);
      };
      stream.getAudioTracks().forEach(track => {
        track.onended = () => {
          if (this.stopping || this.cancelled) return;
          this.cancel();
          this.callbacks.onError(new Error("The microphone disconnected. Please record again."));
        };
      });
      recorder.start(250);
      this.timer = setTimeout(() => this.stop(), MAX_RECORDING_SECONDS * 1000);
      this.callbacks.onStarted();
    } catch (error) {
      if (this.cancelled) return;
      this.cancel();
      this.callbacks.onError(error);
    }
  }

  stop() {
    this.stopping = true;
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.releaseTracks();
  }

  cancel() {
    this.cancelled = true;
    this.stop();
    this.chunks = [];
  }

  private releaseTracks() {
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.stream = null;
  }
}

export async function recordingToWav(blob: Blob): Promise<Blob> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (!decoded.length || decoded.duration > MAX_RECORDING_SECONDS + 1) {
      throw new Error(`Record a voice message of ${MAX_RECORDING_SECONDS} seconds or less.`);
    }
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0));
  } finally {
    await context.close().catch(() => {});
  }
}

export function encodeWav(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true);
  });
  return new Blob([buffer], { type: "audio/wav" });
}
