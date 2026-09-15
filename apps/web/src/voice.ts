export type VoiceCallbacks = {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onState?: (state: "idle" | "listening" | "speaking" | "unsupported") => void;
  onError?: (message: string) => void;
};

export class JazzVoice {
  private recognition: any = null;
  private callbacks: VoiceCallbacks;
  private wakeEnabled = true;
  private selectedVoice: SpeechSynthesisVoice | null = null;
  private listeningRequested = false;
  private restartTimer: number | null = null;
  private restartAttempts = 0;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private micStream: MediaStream | null = null;
  private levelFrame: number | null = null;
  private speakingFrame: number | null = null;
  private levelData: Uint8Array | null = null;

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
      this.scheduleRestart(350);
    };

    this.recognition.onerror = (event: any) => {
      const code = String(event?.error || "");

      if (code === "aborted" || code === "no-speech") return;

      if (code === "network") {
        this.scheduleRestart(700);
        return;
      }

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

      this.scheduleRestart(900);
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

    this.refreshVoice();
    if ("speechSynthesis" in window) {
      window.speechSynthesis.addEventListener("voiceschanged", () => this.refreshVoice());
    }
  }

  private setVisualState(state: "idle" | "listening" | "speaking" | "unsupported") {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.jazzVoiceState = state;
    if (state === "idle" || state === "unsupported") {
      document.documentElement.style.setProperty("--jazz-voice-level", "0");
      document.documentElement.style.setProperty("--jazz-voice-scale", "0.82");
    }
  }

  private setLevel(level: number) {
    if (typeof document === "undefined") return;
    const safe = Math.max(0, Math.min(1, level));
    const scale = 0.82 + safe * 0.58;
    document.documentElement.style.setProperty("--jazz-voice-level", safe.toFixed(3));
    document.documentElement.style.setProperty("--jazz-voice-scale", scale.toFixed(3));
  }

  private async startMicMonitor() {
    if (!navigator.mediaDevices?.getUserMedia || this.micStream) return;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return;
      this.audioContext = this.audioContext || new AudioContextCtor();
      if (this.audioContext.state === "suspended") await this.audioContext.resume();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.72;
      const source = this.audioContext.createMediaStreamSource(this.micStream);
      source.connect(this.analyser);
      this.levelData = new Uint8Array(this.analyser.fftSize);
      this.readMicLevel();
    } catch {
      // SpeechRecognition can still work even if the visual level monitor is unavailable.
    }
  }

  private readMicLevel = () => {
    if (!this.analyser || !this.levelData || !this.listeningRequested) return;
    this.analyser.getByteTimeDomainData(this.levelData);
    let sum = 0;
    for (let i = 0; i < this.levelData.length; i += 1) {
      const sample = (this.levelData[i] - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / this.levelData.length);
    const level = Math.min(1, Math.max(0, (rms - 0.015) * 7.2));
    this.setLevel(level);
    this.levelFrame = window.requestAnimationFrame(this.readMicLevel);
  };

  private stopMicMonitor() {
    if (this.levelFrame !== null) window.cancelAnimationFrame(this.levelFrame);
    this.levelFrame = null;
    this.levelData = null;
    this.analyser?.disconnect();
    this.analyser = null;
    this.micStream?.getTracks().forEach(track => track.stop());
    this.micStream = null;
  }

  private startSpeakingAnimation() {
    if (this.speakingFrame !== null) return;
    const started = performance.now();
    const animate = (now: number) => {
      const elapsed = (now - started) / 1000;
      const pulse = 0.18 + Math.pow((Math.sin(elapsed * 7.2) + 1) / 2, 2) * 0.72;
      this.setLevel(pulse);
      this.speakingFrame = window.requestAnimationFrame(animate);
    };
    this.speakingFrame = window.requestAnimationFrame(animate);
  }

  private stopSpeakingAnimation() {
    if (this.speakingFrame !== null) window.cancelAnimationFrame(this.speakingFrame);
    this.speakingFrame = null;
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
      try {
        this.recognition?.start();
      } catch {
        this.scheduleRestart(Math.min(1500, delay + 200));
      }
    }, delay);
  }

  private refreshVoice() {
    if (!("speechSynthesis" in window)) return;
    const voices = window.speechSynthesis.getVoices();
    const english = voices.filter(voice => /^(en|en[-_])/i.test(voice.lang));
    const preferred = english.find(voice => /female|samantha|zira|aria|jenny|susan|google us english|google uk english/i.test(voice.name));
    this.selectedVoice = preferred || english.find(voice => /en[-_]IN|india/i.test(voice.lang) || /google/i.test(voice.name)) || english[0] || voices[0] || null;
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
    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    try {
      this.recognition.start();
    } catch {
      // Already running.
    }
  }

  stop() {
    this.listeningRequested = false;
    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.stopMicMonitor();
    this.stopSpeakingAnimation();
    try { this.recognition?.stop(); } catch { /* already stopped */ }
    this.setVisualState("idle");
    this.setLevel(0);
    this.callbacks.onState?.("idle");
  }

  speak(text: string) {
    if (!("speechSynthesis" in window)) {
      this.callbacks.onError?.("Speech output is not supported by this browser.");
      return;
    }

    this.refreshVoice();
    window.speechSynthesis.cancel();
    this.stopMicMonitor();
    this.setVisualState("speaking");
    this.startSpeakingAnimation();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = this.selectedVoice;
    utterance.lang = this.selectedVoice?.lang || "en-IN";
    utterance.rate = 0.96;
    utterance.pitch = 1.08;
    utterance.volume = 1;
    utterance.onstart = () => {
      this.setVisualState("speaking");
      this.callbacks.onState?.("speaking");
    };
    utterance.onend = () => {
      this.stopSpeakingAnimation();
      if (this.listeningRequested) {
        this.setVisualState("listening");
        this.callbacks.onState?.("listening");
        void this.startMicMonitor();
      } else {
        this.setVisualState("idle");
        this.setLevel(0);
        this.callbacks.onState?.("idle");
      }
    };
    utterance.onerror = () => {
      this.stopSpeakingAnimation();
      this.setVisualState("idle");
      this.setLevel(0);
      this.callbacks.onState?.("idle");
    };
    window.speechSynthesis.speak(utterance);
  }

  cancelSpeech() {
    window.speechSynthesis?.cancel();
    this.stopSpeakingAnimation();
    this.setVisualState(this.listeningRequested ? "listening" : "idle");
  }

  private stripWakePhrase(text: string) {
    if (!this.wakeEnabled) return text;
    const normalized = text.replace(/[,.!?]/g, "").trim();
    const wake = /^hey\s+jazz\b\s*/i;
    return wake.test(normalized) ? normalized.replace(wake, "").trim() : normalized;
  }
}

declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  }
}
