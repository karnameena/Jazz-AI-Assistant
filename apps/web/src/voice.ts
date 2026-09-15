export type VoiceCallbacks = {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onState?: (state: "idle" | "listening" | "speaking" | "unsupported") => void;
  onError?: (message: string) => void;
};

type VoiceState = "idle" | "listening" | "speaking" | "unsupported";

/**
 * Jazz voice engine.
 *
 * Input: browser SpeechRecognition.
 * Output: local Piper neural TTS through POST /api/tts, with browser
 * speechSynthesis as a graceful fallback when Piper is unavailable.
 */
export class JazzVoice {
  private recognition: any = null;
  private callbacks: VoiceCallbacks;
  private wakeEnabled = true;
  private listeningRequested = false;
  private restartTimer: number | null = null;
  private restartAttempts = 0;

  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private levelFrame: number | null = null;
  private levelData: Uint8Array | null = null;

  private outputSource: MediaElementAudioSourceNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private outputData: Uint8Array | null = null;
  private outputFrame: number | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private speechRunId = 0;

  constructor(callbacks: VoiceCallbacks = {}) {
    this.callbacks = callbacks;
    this.setVisualState("idle");

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      this.setVisualState("unsupported");
      this.callbacks.onState?.("unsupported");
      return;
    }

    this.recognition = new Recognition();
    this.recognition.lang = "en-IN";
    this.recognition.interimResults = true;
    this.recognition.continuous = true;
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.restartAttempts = 0;
      this.setVisualState("listening");
      this.callbacks.onState?.("listening");
      void this.startMicMonitor();
    };

    this.recognition.onend = () => {
      if (!this.listeningRequested) {
        this.stopMicMonitor();
        this.setVisualState("idle");
        this.callbacks.onState?.("idle");
        return;
      }
      this.scheduleRestart(300);
    };

    this.recognition.onerror = (event: any) => {
      const code = String(event?.error || "");
      if (code === "aborted" || code === "no-speech") return;
      if (code === "network") { this.scheduleRestart(650); return; }
      if (code === "audio-capture") {
        this.listeningRequested = false;
        this.stopMicMonitor();
        this.setVisualState("idle");
        this.callbacks.onState?.("idle");
        this.callbacks.onError?.("I lost access to the microphone. Please check microphone permission and try again.");
        return;
      }
      if (code === "not-allowed" || code === "service-not-allowed") {
        this.listeningRequested = false;
        this.stopMicMonitor();
        this.setVisualState("idle");
        this.callbacks.onState?.("idle");
        this.callbacks.onError?.("Microphone permission is blocked. Please allow microphone access for Jazz in your browser.");
        return;
      }
      this.scheduleRestart(850);
    };

    this.recognition.onresult = (event: any) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalText += text;
        else interim += text;
      }
      if (interim) this.callbacks.onInterim?.(interim.trim());
      if (finalText.trim()) this.callbacks.onFinal?.(this.stripWakePhrase(finalText.trim()));
    };
  }

  private setVisualState(state: VoiceState) {
    document.documentElement.dataset.jazzVoiceState = state;
    if (state === "idle" || state === "unsupported") {
      document.documentElement.style.setProperty("--jazz-voice-level", "0");
      document.documentElement.style.setProperty("--jazz-voice-scale", "0.82");
    }
  }

  private setLevel(level: number) {
    const safe = Math.max(0, Math.min(1, level));
    const scale = 0.82 + safe * 0.58;
    document.documentElement.style.setProperty("--jazz-voice-level", safe.toFixed(3));
    document.documentElement.style.setProperty("--jazz-voice-scale", scale.toFixed(3));
  }

  private async ensureAudioContext() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    this.audioContext = this.audioContext || new AudioContextCtor();
    if (this.audioContext.state === "suspended") await this.audioContext.resume();
    return this.audioContext;
  }

  private async startMicMonitor() {
    if (!navigator.mediaDevices?.getUserMedia || this.micStream) return;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = await this.ensureAudioContext();
      if (!context || !this.micStream) return;
      this.micAnalyser = context.createAnalyser();
      this.micAnalyser.fftSize = 256;
      this.micAnalyser.smoothingTimeConstant = 0.72;
      this.micSource = context.createMediaStreamSource(this.micStream);
      this.micSource.connect(this.micAnalyser);
      this.levelData = new Uint8Array(this.micAnalyser.fftSize);
      this.readMicLevel();
    } catch {
      // Speech recognition remains usable without the visual level monitor.
    }
  }

  private readMicLevel = () => {
    if (!this.micAnalyser || !this.levelData || !this.listeningRequested) return;
    this.micAnalyser.getByteTimeDomainData(this.levelData);
    let sum = 0;
    for (let i = 0; i < this.levelData.length; i += 1) {
      const sample = (this.levelData[i] - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / this.levelData.length);
    this.setLevel(Math.min(1, Math.max(0, (rms - 0.015) * 7.2)));
    this.levelFrame = window.requestAnimationFrame(this.readMicLevel);
  };

  private stopMicMonitor() {
    if (this.levelFrame !== null) window.cancelAnimationFrame(this.levelFrame);
    this.levelFrame = null;
    this.levelData = null;
    this.micSource?.disconnect();
    this.micSource = null;
    this.micAnalyser?.disconnect();
    this.micAnalyser = null;
    this.micStream?.getTracks().forEach(track => track.stop());
    this.micStream = null;
  }

  private startOutputMonitor(audio: HTMLAudioElement) {
    void this.ensureAudioContext().then(context => {
      if (!context || this.currentAudio !== audio) return;
      try {
        if (!this.outputSource) this.outputSource = context.createMediaElementSource(audio);
        this.outputAnalyser?.disconnect();
        this.outputAnalyser = context.createAnalyser();
        this.outputAnalyser.fftSize = 256;
        this.outputAnalyser.smoothingTimeConstant = 0.68;
        this.outputSource.connect(this.outputAnalyser);
        this.outputAnalyser.connect(context.destination);
        this.outputData = new Uint8Array(this.outputAnalyser.fftSize);
        this.readOutputLevel();
      } catch {
        // The audio element can still play even if an analyser cannot be attached.
      }
    });
  }

  private readOutputLevel = () => {
    if (!this.outputAnalyser || !this.outputData || !this.currentAudio || this.currentAudio.paused) {
      this.outputFrame = null;
      return;
    }
    this.outputAnalyser.getByteTimeDomainData(this.outputData);
    let sum = 0;
    for (let i = 0; i < this.outputData.length; i += 1) {
      const sample = (this.outputData[i] - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / this.outputData.length);
    this.setLevel(Math.min(1, Math.max(0, (rms - 0.01) * 8.5)));
    this.outputFrame = window.requestAnimationFrame(this.readOutputLevel);
  };

  private stopOutputMonitor() {
    if (this.outputFrame !== null) window.cancelAnimationFrame(this.outputFrame);
    this.outputFrame = null;
    this.outputData = null;
    this.outputAnalyser?.disconnect();
    this.outputAnalyser = null;
  }

  private scheduleRestart(delay: number) {
    if (!this.listeningRequested || this.restartTimer !== null) return;
    if (this.restartAttempts >= 6) {
      this.listeningRequested = false;
      this.stopMicMonitor();
      this.setVisualState("idle");
      this.callbacks.onState?.("idle");
      this.callbacks.onError?.("Voice connection could not be restored. Tap the microphone to try again.");
      return;
    }
    this.restartAttempts += 1;
    this.setVisualState("listening");
    this.callbacks.onState?.("listening");
    this.restartTimer = window.setTimeout(() => {
      this.restartTimer = null;
      try { this.recognition?.start(); }
      catch { this.scheduleRestart(Math.min(1400, delay + 180)); }
    }, delay);
  }

  isSupported() { return Boolean(this.recognition); }
  setWakePhraseEnabled(enabled: boolean) { this.wakeEnabled = enabled; }

  start() {
    if (!this.recognition) {
      this.callbacks.onError?.("Speech recognition is not supported by this browser. Chrome or Edge is recommended.");
      return;
    }
    this.listeningRequested = true;
    this.restartAttempts = 0;
    this.setVisualState("listening");
    this.setLevel(0.12);
    if (this.restartTimer !== null) { window.clearTimeout(this.restartTimer); this.restartTimer = null; }
    try { this.recognition.start(); } catch { /* already running */ }
  }

  stop() {
    this.listeningRequested = false;
    if (this.restartTimer !== null) { window.clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.stopMicMonitor();
    this.stopOutputMonitor();
    this.speechRunId += 1;
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = "";
      this.currentAudio = null;
    }
    window.speechSynthesis?.cancel();
    try { this.recognition?.stop(); } catch { /* already stopped */ }
    this.setVisualState("idle");
    this.setLevel(0);
    this.callbacks.onState?.("idle");
  }

  /** Speak using local Piper first, then browser TTS as a fallback. */
  async speak(text: string) {
    const clean = this.cleanForSpeech(text);
    if (!clean) return;
    const runId = ++this.speechRunId;
    window.speechSynthesis?.cancel();
    this.stopMicMonitor();
    this.setVisualState("speaking");
    this.callbacks.onState?.("speaking");

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean })
      });
      if (!response.ok) throw new Error("Piper TTS unavailable");
      const blob = await response.blob();
      if (runId !== this.speechRunId) return;
      await this.playAudioBlob(blob, runId);
      return;
    } catch {
      // Keep Jazz usable during setup or if Piper is temporarily offline.
      if (runId !== this.speechRunId) return;
      this.speakBrowserFallback(clean, runId);
    }
  }

  private async playAudioBlob(blob: Blob, runId: number) {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.preload = "auto";
    this.currentAudio = audio;
    this.startOutputMonitor(audio);

    await new Promise<void>(resolve => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      void audio.play().catch(() => resolve());
    });

    URL.revokeObjectURL(url);
    if (runId !== this.speechRunId) return;
    this.currentAudio = null;
    this.stopOutputMonitor();
    this.finishSpeaking();
  }

  private speakBrowserFallback(text: string, runId: number) {
    if (!("speechSynthesis" in window)) {
      this.finishSpeaking();
      return;
    }
    const voices = window.speechSynthesis.getVoices();
    const english = voices.filter(v => /^(en|en[-_])/i.test(v.lang));
    const pool = english.length ? english : voices;
    const selected = [...pool].sort((a, b) => this.voiceScore(b) - this.voiceScore(a))[0] || null;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = selected;
    utterance.lang = selected?.lang || "en-US";
    utterance.rate = 1.04;
    utterance.pitch = 1.10;
    utterance.volume = 1;
    utterance.onend = () => { if (runId === this.speechRunId) this.finishSpeaking(); };
    utterance.onerror = () => { if (runId === this.speechRunId) this.finishSpeaking(); };
    window.speechSynthesis.speak(utterance);
  }

  private voiceScore(voice: SpeechSynthesisVoice) {
    const name = voice.name.toLowerCase();
    const lang = voice.lang.toLowerCase();
    let score = 0;
    if (/jenny|aria|samantha|zira|sara|sonia|libby|hazel|ava|emma|susan/.test(name)) score += 45;
    if (/female|woman|girl/.test(name)) score += 28;
    if (/natural|neural|online|enhanced|premium/.test(name)) score += 38;
    if (/microsoft|google|apple/.test(name)) score += 8;
    if (/en-us/.test(lang)) score += 8;
    if (/en-gb|en-au/.test(lang)) score += 5;
    if (/en-in/.test(lang)) score += 4;
    if (voice.localService === false) score += 10;
    return score;
  }

  private finishSpeaking() {
    if (this.listeningRequested) {
      this.setVisualState("listening");
      this.callbacks.onState?.("listening");
      void this.startMicMonitor();
    } else {
      this.setVisualState("idle");
      this.setLevel(0);
      this.callbacks.onState?.("idle");
    }
  }

  private cleanForSpeech(text: string) {
    return text
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*#{1,6}\s+/gm, "")
      .replace(/[\*_~]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private stripWakePhrase(text: string) {
    if (!this.wakeEnabled) return text;
    return text.replace(/^\s*(?:hey\s+)?jazz[\s,!.:-]*/i, "").trim() || text;
  }
}
