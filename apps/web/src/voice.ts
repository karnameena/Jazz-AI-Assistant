export type VoiceCallbacks = {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onState?: (state: "idle" | "listening" | "speaking" | "unsupported") => void;
  onError?: (message: string) => void;
};

type VoiceState = "idle" | "listening" | "speaking" | "unsupported";

/** Jazz voice engine: browser SpeechRecognition input + low-latency local Piper PCM streaming output. */
export class JazzVoice {
  private recognition: any = null;
  private callbacks: VoiceCallbacks;
  private wakeEnabled = true;
  private listeningRequested = false;
  private recognitionStarted = false;
  private recognitionStarting = false;
  private restartTimer: number | null = null;
  private restartAttempts = 0;
  private recognitionLanguage = "en-US";
  private triedLanguageFallback = false;

  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private levelFrame: number | null = null;
  private levelData: Uint8Array | null = null;

  private outputAnalyser: AnalyserNode | null = null;
  private outputData: Uint8Array | null = null;
  private outputFrequencyData: Uint8Array | null = null;
  private outputFrame: number | null = null;
  private outputSources = new Set<AudioBufferSourceNode>();
  private streamPlaying = false;
  private speechRunId = 0;
  private visualLevel = 0;
  private visualPeak = 0;

  constructor(callbacks: VoiceCallbacks = {}) {
    this.callbacks = callbacks;
    this.setVisualState("idle");

    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      this.setVisualState("unsupported");
      this.callbacks.onState?.("unsupported");
      return;
    }

    const browserLanguage = String(navigator.language || "").trim();
    this.recognitionLanguage = /^en[-_]/i.test(browserLanguage) ? browserLanguage.replace("_", "-") : "en-US";

    this.recognition = new Recognition();
    this.recognition.lang = this.recognitionLanguage;
    this.recognition.interimResults = true;
    this.recognition.continuous = false;
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.recognitionStarting = false;
      this.recognitionStarted = true;
      this.restartAttempts = 0;
      this.setVisualState("listening");
      this.callbacks.onState?.("listening");

      // Important: start the visual microphone analyser only AFTER Chromium's
      // SpeechRecognition service has acquired the microphone. Opening our own
      // MediaStream first can leave some Windows/Chromium setups listening but
      // never returning transcripts.
      void this.startMicMonitor().catch(() => undefined);
    };

    this.recognition.onend = () => {
      this.recognitionStarting = false;
      this.recognitionStarted = false;
      if (!this.listeningRequested) {
        this.stopMicMonitor();
        this.setVisualState("idle");
        this.callbacks.onState?.("idle");
        return;
      }
      this.scheduleRestart(250);
    };

    this.recognition.onnomatch = () => {
      if (this.listeningRequested) {
        this.callbacks.onError?.("I can hear the microphone, but I couldn't recognize those words. Please speak again.");
      }
    };

    this.recognition.onerror = (event: any) => {
      const code = String(event?.error || "");
      this.recognitionStarting = false;
      this.recognitionStarted = false;

      if (code === "aborted") return;

      if (code === "no-speech") {
        if (this.listeningRequested) this.scheduleRestart(300);
        return;
      }

      if (code === "language-not-supported" && !this.triedLanguageFallback) {
        this.triedLanguageFallback = true;
        this.recognitionLanguage = "en-US";
        this.recognition.lang = "en-US";
        if (this.listeningRequested) this.scheduleRestart(250);
        return;
      }

      if (code === "network") {
        this.listeningRequested = false;
        this.stopMicMonitor();
        this.setVisualState("idle");
        this.callbacks.onState?.("idle");
        this.callbacks.onError?.("The microphone is available, but Chrome/Edge speech-to-text could not connect. Try the current Microsoft Edge or Chrome build and make sure browser speech services are not blocked by VPN/firewall.");
        return;
      }

      if (code === "audio-capture") {
        this.listeningRequested = false;
        this.stopMicMonitor();
        this.setVisualState("idle");
        this.callbacks.onState?.("idle");
        this.callbacks.onError?.("Jazz cannot capture microphone audio. Check the selected Windows input device and browser microphone permission.");
        return;
      }

      if (code === "not-allowed" || code === "service-not-allowed") {
        this.listeningRequested = false;
        this.stopMicMonitor();
        this.setVisualState("idle");
        this.callbacks.onState?.("idle");
        this.callbacks.onError?.("Microphone permission is blocked. Allow microphone access for localhost:5173, then tap the mic again.");
        return;
      }

      if (code === "language-not-supported") {
        this.listeningRequested = false;
        this.stopMicMonitor();
        this.setVisualState("idle");
        this.callbacks.onState?.("idle");
        this.callbacks.onError?.("Browser speech recognition does not have a usable English speech model.");
        return;
      }

      this.callbacks.onError?.(`Browser speech recognition error: ${code || "unknown"}.`);
      if (this.listeningRequested) this.scheduleRestart(650);
    };

    this.recognition.onresult = (event: any) => {
      let interim = "";
      let finalText = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalText += text;
        else interim += text;
      }

      const interimText = interim.trim();
      const completedText = finalText.trim();

      if (interimText) this.callbacks.onInterim?.(this.stripWakePhrase(interimText));
      if (completedText) this.callbacks.onFinal?.(this.stripWakePhrase(completedText));
    };
  }

  private setVisualState(state: VoiceState) {
    document.documentElement.dataset.jazzVoiceState = state;
    if (state === "idle" || state === "unsupported") {
      this.visualLevel = 0;
      this.visualPeak = 0;
      document.documentElement.style.setProperty("--jazz-voice-level", "0");
      document.documentElement.style.setProperty("--jazz-voice-peak", "0");
      document.documentElement.style.setProperty("--jazz-voice-bass", "0");
      document.documentElement.style.setProperty("--jazz-voice-mid", "0");
      document.documentElement.style.setProperty("--jazz-voice-treble", "0");
      document.documentElement.style.setProperty("--jazz-voice-scale", "0.96");
    }
  }

  private setLevel(level: number, bass = level, mid = level, treble = level) {
    const safe = Math.max(0, Math.min(1, level));
    const attack = safe > this.visualLevel ? 0.68 : 0.2;
    this.visualLevel += (safe - this.visualLevel) * attack;
    this.visualPeak = Math.max(this.visualLevel, this.visualPeak * 0.9);
    const scale = 0.96 + this.visualLevel * 0.20 + this.visualPeak * 0.045;
    const root = document.documentElement.style;
    root.setProperty("--jazz-voice-level", this.visualLevel.toFixed(3));
    root.setProperty("--jazz-voice-peak", this.visualPeak.toFixed(3));
    root.setProperty("--jazz-voice-bass", Math.max(0, Math.min(1, bass)).toFixed(3));
    root.setProperty("--jazz-voice-mid", Math.max(0, Math.min(1, mid)).toFixed(3));
    root.setProperty("--jazz-voice-treble", Math.max(0, Math.min(1, treble)).toFixed(3));
    root.setProperty("--jazz-voice-scale", scale.toFixed(3));
  }

  private async ensureAudioContext() {
    const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return null;
    this.audioContext = this.audioContext || new AudioContextCtor();
    if (this.audioContext.state === "suspended") await this.audioContext.resume();
    return this.audioContext;
  }

  private async probeMicrophonePermission() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Browser microphone capture is unavailable.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = stream.getAudioTracks().find(item => item.readyState === "live" && item.enabled);
    stream.getTracks().forEach(item => item.stop());
    if (!track) throw new Error("No active microphone track is available.");
  }

  private async startMicMonitor() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    if (this.micAnalyser || !this.listeningRequested) return;

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    if (!this.listeningRequested) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null;
      return;
    }

    const activeTrack = this.micStream.getAudioTracks().find(track => track.readyState === "live" && track.enabled);
    if (!activeTrack) throw new Error("No active microphone track is available.");

    const context = await this.ensureAudioContext();
    if (!context || !this.micStream) return;
    this.micAnalyser = context.createAnalyser();
    this.micAnalyser.fftSize = 256;
    this.micAnalyser.smoothingTimeConstant = 0.45;
    this.micSource = context.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.micAnalyser);
    this.levelData = new Uint8Array(this.micAnalyser.fftSize);
    this.readMicLevel();
  }

  private readMicLevel = () => {
    if (!this.micAnalyser || !this.levelData || !this.listeningRequested) return;
    this.micAnalyser.getByteTimeDomainData(this.levelData);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < this.levelData.length; i += 1) {
      const sample = (this.levelData[i] - 128) / 128;
      sum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const rms = Math.sqrt(sum / this.levelData.length);
    const level = Math.min(1, Math.max(0, (rms - 0.012) * 7.8 + peak * 0.24));
    this.setLevel(level, level * 0.82, level, level * 0.72);
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

  /** Prepare a Web Audio analyser for streamed PCM output. */
  private async startOutputMonitor() {
    const context = await this.ensureAudioContext();
    if (!context) return null;
    this.stopOutputMonitor(false);
    this.outputAnalyser = context.createAnalyser();
    this.outputAnalyser.fftSize = 1024;
    this.outputAnalyser.smoothingTimeConstant = 0.3;
    this.outputAnalyser.connect(context.destination);
    this.outputData = new Uint8Array(this.outputAnalyser.fftSize);
    this.outputFrequencyData = new Uint8Array(this.outputAnalyser.frequencyBinCount);
    this.readOutputLevel();
    return context;
  }

  private averageBand(data: Uint8Array, start: number, end: number) {
    const from = Math.max(0, Math.min(data.length - 1, start));
    const to = Math.max(from + 1, Math.min(data.length, end));
    let sum = 0;
    for (let i = from; i < to; i += 1) sum += data[i];
    return sum / ((to - from) * 255);
  }

  private readOutputLevel = () => {
    if (!this.outputAnalyser || !this.outputData || !this.outputFrequencyData || !this.streamPlaying) {
      this.outputFrame = null;
      return;
    }

    this.outputAnalyser.getByteTimeDomainData(this.outputData);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < this.outputData.length; i += 1) {
      const sample = (this.outputData[i] - 128) / 128;
      sum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }

    const rms = Math.sqrt(sum / this.outputData.length);
    this.outputAnalyser.getByteFrequencyData(this.outputFrequencyData);
    const binHz = (this.audioContext?.sampleRate || 22050) / this.outputAnalyser.fftSize;
    const bass = this.averageBand(this.outputFrequencyData, Math.floor(70 / binHz), Math.ceil(280 / binHz));
    const mid = this.averageBand(this.outputFrequencyData, Math.floor(280 / binHz), Math.ceil(2200 / binHz));
    const treble = this.averageBand(this.outputFrequencyData, Math.floor(2200 / binHz), Math.ceil(7200 / binHz));
    const raw = (rms - 0.0055) * 8.7 + peak * 0.30 + mid * 0.36 + bass * 0.14;
    this.setLevel(Math.min(1, Math.max(0, raw)), bass, mid, treble);
    this.outputFrame = window.requestAnimationFrame(this.readOutputLevel);
  };

  private stopOutputMonitor(stopSources = true) {
    if (this.outputFrame !== null) window.cancelAnimationFrame(this.outputFrame);
    this.outputFrame = null;
    this.outputData = null;
    this.outputFrequencyData = null;

    if (stopSources) {
      for (const source of this.outputSources) {
        try { source.stop(); } catch { /* already stopped */ }
      }
    }

    this.outputSources.clear();
    this.outputAnalyser?.disconnect();
    this.outputAnalyser = null;
    this.streamPlaying = false;
  }

  private startRecognitionNow() {
    if (!this.recognition || !this.listeningRequested || this.recognitionStarting || this.recognitionStarted) return;
    this.recognitionStarting = true;
    this.recognition.lang = this.recognitionLanguage;

    try {
      this.recognition.start();
    } catch (error) {
      this.recognitionStarting = false;
      const message = error instanceof Error ? error.message : String(error);
      if (!/already started|recognition has already started/i.test(message)) {
        this.listeningRequested = false;
        this.setVisualState("idle");
        this.callbacks.onState?.("idle");
        this.callbacks.onError?.(`Jazz could not start browser speech recognition: ${message}`);
      }
    }
  }

  private scheduleRestart(delay: number) {
    if (!this.listeningRequested || this.restartTimer !== null) return;
    if (this.restartAttempts >= 8) {
      this.listeningRequested = false;
      this.stopMicMonitor();
      this.setVisualState("idle");
      this.callbacks.onState?.("idle");
      this.callbacks.onError?.("Speech recognition stopped repeatedly. Tap the microphone and try again.");
      return;
    }

    this.restartAttempts += 1;
    this.restartTimer = window.setTimeout(() => {
      this.restartTimer = null;
      this.startRecognitionNow();
    }, delay);
  }

  isSupported() { return Boolean(this.recognition); }
  setWakePhraseEnabled(enabled: boolean) { this.wakeEnabled = enabled; }

  async start() {
    if (!this.recognition) {
      this.callbacks.onError?.("Speech recognition is not supported by this browser. Use current Chrome or Edge.");
      return;
    }

    if (this.listeningRequested && (this.recognitionStarted || this.recognitionStarting)) return;

    this.listeningRequested = true;
    this.restartAttempts = 0;
    this.triedLanguageFallback = false;
    this.setLevel(0.08);

    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    try {
      // Probe permission, release that temporary stream, THEN start the Web Speech
      // recognizer. This prevents a separate analyser stream from owning the mic
      // before SpeechRecognition starts.
      await this.probeMicrophonePermission();
      if (!this.listeningRequested) return;
      this.startRecognitionNow();
    } catch (error) {
      this.listeningRequested = false;
      this.stopMicMonitor();
      this.setVisualState("idle");
      this.callbacks.onState?.("idle");
      const name = error instanceof DOMException ? error.name : "";

      if (name === "NotAllowedError" || name === "SecurityError") {
        this.callbacks.onError?.("Microphone permission is blocked. Click the lock/tune icon beside localhost:5173, set Microphone to Allow, then tap the mic again.");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        this.callbacks.onError?.("No microphone was found. Check the Windows input device and try again.");
      } else {
        this.callbacks.onError?.(`Jazz could not open the microphone: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  stop() {
    this.listeningRequested = false;
    this.recognitionStarting = false;
    this.recognitionStarted = false;

    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    this.stopMicMonitor();
    this.stopOutputMonitor(true);
    this.speechRunId += 1;
    window.speechSynthesis?.cancel();
    try { this.recognition?.stop(); } catch { /* already stopped */ }
    this.setVisualState("idle");
    this.setLevel(0);
    this.callbacks.onState?.("idle");
  }

  async speak(text: string) {
    const clean = this.cleanForSpeech(text);
    if (!clean) return;

    const runId = ++this.speechRunId;
    window.speechSynthesis?.cancel();
    this.stopMicMonitor();
    this.stopOutputMonitor(true);
    this.setVisualState("speaking");
    this.callbacks.onState?.("speaking");
    this.setLevel(0.04);

    try {
      const ok = await this.playPiperStream(clean, runId);
      if (runId !== this.speechRunId) return;
      if (!ok) throw new Error("Piper TTS unavailable");
      this.finishSpeaking();
    } catch {
      if (runId !== this.speechRunId) return;
      this.stopOutputMonitor(true);
      this.speakBrowserFallback(clean, runId);
    }
  }

  private async playPiperStream(text: string, runId: number) {
    const context = await this.startOutputMonitor();
    if (!context) return false;

    const response = await fetch("/api/tts/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });

    if (!response.ok || !response.body) return false;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventName = "";
    let nextAudioTime = context.currentTime + 0.025;
    let scheduled = 0;
    let streamDone = false;
    let streamError: Error | null = null;

    const handleEvent = async (name: string, payload: string) => {
      if (!payload) return;
      let data: any;
      try { data = JSON.parse(payload); } catch { return; }
      if (runId !== this.speechRunId) return;
      if (name === "meta") return;
      if (name === "error") {
        streamError = new Error(data?.error || "Piper streaming failed");
        return;
      }
      if (name === "audio" && typeof data?.data === "string") {
        const bytes = Uint8Array.from(atob(data.data), char => char.charCodeAt(0));
        if (!bytes.length) return;
        const sampleCount = Math.floor(bytes.byteLength / 2);
        const samples = new Float32Array(sampleCount);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        for (let i = 0; i < sampleCount; i += 1) {
          samples[i] = Math.max(-1, Math.min(1, view.getInt16(i * 2, true) / 32768));
        }

        const audioBuffer = context.createBuffer(1, sampleCount, 22050);
        audioBuffer.copyToChannel(samples, 0);
        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.outputAnalyser!);
        this.outputSources.add(source);
        const startAt = Math.max(nextAudioTime, context.currentTime + 0.01);
        source.start(startAt);
        const duration = sampleCount / 22050;
        nextAudioTime = startAt + duration;
        scheduled += sampleCount;
        this.streamPlaying = true;
        source.onended = () => {
          this.outputSources.delete(source);
          if (streamDone && this.outputSources.size === 0) this.streamPlaying = false;
        };
      }
      if (name === "done") streamDone = true;
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) await handleEvent(eventName, line.slice(5).trim());
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) await handleEvent(eventName, line.slice(5).trim());
      }
    }

    if (streamError || scheduled === 0 || runId !== this.speechRunId) {
      throw streamError || new Error("Piper returned no audio");
    }

    streamDone = true;
    const remainingMs = Math.max(0, (nextAudioTime - context.currentTime) * 1000);
    await new Promise(resolve => window.setTimeout(resolve, remainingMs + 25));
    this.streamPlaying = false;
    return true;
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
    utterance.onboundary = () => this.setLevel(0.28 + Math.random() * 0.28, 0.18, 0.42, 0.30);
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
      void this.startMicMonitor().catch(() => undefined);
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
    return text.replace(/^\s*(?:hey\s+)?jazz[,:;.!-]?\s*/i, "").trim() || text;
  }
}
