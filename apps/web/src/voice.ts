export type VoiceCallbacks = {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onState?: (state: "idle" | "listening" | "speaking" | "unsupported") => void;
  onError?: (message: string) => void;
};

type VoiceState = "idle" | "listening" | "speaking" | "unsupported";

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
      this.scheduleRestart(300);
    };

    this.recognition.onerror = (event: any) => {
      const code = String(event?.error || "");

      if (code === "aborted" || code === "no-speech") return;

      if (code === "network") {
        this.scheduleRestart(650);
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

    this.refreshVoice();
    if ("speechSynthesis" in window) {
      window.speechSynthesis.addEventListener("voiceschanged", () => this.refreshVoice());
    }
  }

  private setVisualState(state: VoiceState) {
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
      // SpeechRecognition can still work if the visual level monitor is unavailable.
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
      // Slightly irregular layered movement feels more organic than a fixed beat.
      const breath = (Math.sin(elapsed * 6.7) + 1) / 2;
      const shimmer = (Math.sin(elapsed * 11.9 + 1.1) + 1) / 2;
      const pulse = 0.14 + breath * 0.40 + shimmer * 0.24;
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
        this.scheduleRestart(Math.min(1400, delay + 180));
      }
    }, delay);
  }

  private refreshVoice() {
    if (!("speechSynthesis" in window)) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;

    const english = voices.filter(voice => /^(en|en[-_])/i.test(voice.lang));
    const pool = english.length ? english : voices;

    // Score voices instead of blindly taking the first "female" match.
    // This favors modern natural/neural female voices when the browser exposes them.
    const scored = pool.map(voice => {
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

      return { voice, score };
    });

    scored.sort((a, b) => b.score - a.score);
    this.selectedVoice = scored[0]?.voice || pool[0] || null;
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
   * Speak with a relaxed conversational cadence. The browser remains responsible
   * for the actual voice synthesis, while Jazz controls voice choice, pace,
   * punctuation and short thought-groups so the delivery feels less robotic.
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
    const normalized = text
      .replace(/\s+/g, " ")
      .replace(/\s*[:;]\s*/g, ", ")
      .trim();

    // Prefer complete thoughts. Only split long sentences when needed so the
    // browser can preserve its own natural prosody instead of sounding choppy.
    const sentences = normalized
      .split(/(?<=[.!?])\s+/)
      .map(part => part.trim())
      .filter(Boolean);

    const groups: string[] = [];
    let buffer = "";

    for (const sentence of sentences) {
      const candidate = buffer ? `${buffer} ${sentence}` : sentence;
      if (candidate.length <= 260) {
        buffer = candidate;
        continue;
      }

      if (buffer) groups.push(buffer);
      buffer = sentence;

      if (buffer.length > 300) {
        const words = buffer.split(" ");
        buffer = "";
        let chunk = "";
        for (const word of words) {
          const next = chunk ? `${chunk} ${word}` : word;
          if (next.length > 220 && chunk) {
            groups.push(chunk);
            chunk = word;
          } else {
            chunk = next;
          }
        }
        buffer = chunk;
      }
    }

    if (buffer) groups.push(buffer);

    return groups.map((group, index) => {
      const utterance = new SpeechSynthesisUtterance(group);
      utterance.voice = this.selectedVoice;
      utterance.lang = this.selectedVoice?.lang || "en-US";

      // A little quicker than the browser default, but not rushed.
      // Small variation prevents every sentence from having identical timing.
      const rates = [1.05, 1.07, 1.04, 1.06];
      utterance.rate = rates[index % rates.length];
      utterance.pitch = 1.10;
      utterance.volume = 1;

      utterance.onend = () => {
        if (runId !== this.speechRunId) return;
        this.speechIndex += 1;
        if (this.speechIndex < this.speechQueue.length) {
          // A tiny breath-like gap, not a long robotic pause.
          window.setTimeout(() => this.speakNext(runId), 45);
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
      .replace(/[*_#>]/g, "")
      .replace(/^\s*[-•]\s+/gm, "")
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
