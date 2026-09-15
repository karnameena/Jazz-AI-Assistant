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
  private speechQueue: SpeechSynthesisUtterance[] = [];
  private speechIndex = 0;
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
      // Human-like breathing/pulsing rather than a perfectly regular computer-style beat.
      const pulseA = (Math.sin(elapsed * 8.4) + 1) / 2;
      const pulseB = (Math.sin(elapsed * 13.7 + 1.4) + 1) / 2;
      const pulse = 0.16 + pulseA * 0.44 + pulseB * 0.22;
      this.setLevel(Math.min(1, pulse));
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
    if (!voices.length) return;

    const english = voices.filter(voice => /^(en|en[-_])/i.test(voice.lang));
    const pool = english.length ? english : voices;

    // Prefer natural-sounding female voices. Browser voice names differ by OS,
    // so this intentionally uses several common Google/Microsoft/Apple names.
    const femaleNatural = [
      /jenny/i,
      /aria/i,
      /zira/i,
      /samantha/i,
      /susan/i,
      /sara/i,
      /sonia/i,
      /libby/i,
      /hazel/i,
      /ava/i,
      /emma/i,
      /google us english female/i,
      /google uk english female/i,
      /female/i,
    ];

    const femaleMatch = pool.find(voice => femaleNatural.some(pattern => pattern.test(voice.name)));
    const indiaMatch = pool.find(voice => /en[-_]IN/i.test(voice.lang) && /female|jenny|aria|sara|google|microsoft/i.test(voice.name));
    const naturalMatch = pool.find(voice => /online|natural|neural|enhanced/i.test(voice.name));
    const googleMatch = pool.find(voice => /google/i.test(voice.name));

    this.selectedVoice = femaleMatch || indiaMatch || naturalMatch || googleMatch || pool[0] || null;
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
    this.speechRunId += 1;
    this.speechQueue = [];
    this.speechIndex = 0;
    window.speechSynthesis?.cancel();
    try { this.recognition?.stop(); } catch { /* already stopped */ }
    this.setVisualState("idle");
    this.setLevel(0);
    this.callbacks.onState?.("idle");
  }

  /**
   * Speaks in short conversational thought-groups. This keeps Jazz responsive
   * and lets punctuation create natural micro-pauses instead of one long,
   * slow computer-style utterance.
   */
  speak(text: string) {
    if (!("speechSynthesis" in window)) {
      this.callbacks.onError?.("Speech output is not supported by this browser.");
      return;
    }

    const clean = this.cleanForSpeech(text);
    if (!clean) return;

    this.refreshVoice();
    const runId = ++this.speechRunId;
    window.speechSynthesis.cancel();
    this.stopMicMonitor();
    this.speechQueue = this.makeSpeechQueue(clean, runId);
    this.speechIndex = 0;
    this.setVisualState("speaking");
    this.startSpeakingAnimation();
    this.callbacks.onState?.("speaking");
    this.speakNext(runId);
  }

  private makeSpeechQueue(text: string, runId: number) {
    const groups = text
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map(part => part.trim())
      .filter(Boolean);

    // Avoid tiny one-word utterances, which can create unnatural gaps.
    const merged: string[] = [];
    for (const group of groups) {
      if (merged.length && group.length < 28 && !/[!?]$/.test(merged[merged.length - 1])) {
        merged[merged.length - 1] += ` ${group}`;
      } else {
        merged.push(group);
      }
    }

    return merged.map((group, index) => {
      const utterance = new SpeechSynthesisUtterance(group);
      utterance.voice = this.selectedVoice;
      utterance.lang = this.selectedVoice?.lang || "en-IN";
      // Slightly faster than default, with a light, youthful pitch.
      utterance.rate = index % 3 === 1 ? 1.06 : 1.03;
      utterance.pitch = 1.14;
      utterance.volume = 1;
      utterance.onend = () => {
        if (runId !== this.speechRunId) return;
        this.speechIndex += 1;
        if (this.speechIndex < this.speechQueue.length) {
          window.setTimeout(() => this.speakNext(runId), 35);
        } else {
          this.finishSpeaking();
        }
      };
      utterance.onerror = () => {
        if (runId !== this.speechRunId) return;
        this.finishSpeaking();
      };
      return utterance;
    });
  }

  private speakNext(runId: number) {
    if (runId !== this.speechRunId) return;
    const utterance = this.speechQueue[this.speechIndex];
    if (!utterance) {
      this.finishSpeaking();
      return;
    }
    this.setVisualState("speaking");
    window.speechSynthesis.speak(utterance);
  }

  private finishSpeaking() {
    this.stopSpeakingAnimation();
    this.speechQueue = [];
    this.speechIndex = 0;
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
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[*_#>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  cancelSpeech() {
    this.speechRunId += 1;
    this.speechQueue = [];
    this.speechIndex = 0;
    window.speechSynthesis?.cancel();
    this.stopSpeakingAnimation();
    this.setVisualState(this.listeningRequested ? "listening" : "idle");
    this.setLevel(0);
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
