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

  constructor(callbacks: VoiceCallbacks = {}) {
    this.callbacks = callbacks;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
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
      this.callbacks.onState?.("listening");
    };

    this.recognition.onend = () => {
      if (!this.listeningRequested) {
        this.callbacks.onState?.("idle");
        return;
      }
      this.scheduleRestart(350);
    };

    this.recognition.onerror = (event: any) => {
      const code = String(event?.error || "");

      // Browser SpeechRecognition commonly reports temporary network/no-speech
      // errors even while the microphone is healthy. Do not dump raw error codes
      // into the conversation UI.
      if (code === "aborted" || code === "no-speech") return;

      if (code === "network") {
        this.scheduleRestart(700);
        return;
      }

      if (code === "audio-capture") {
        this.listeningRequested = false;
        this.callbacks.onState?.("idle");
        this.callbacks.onError?.("I lost access to the microphone. Please check microphone permission and try again.");
        return;
      }

      if (code === "not-allowed" || code === "service-not-allowed") {
        this.listeningRequested = false;
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

  private scheduleRestart(delay: number) {
    if (!this.listeningRequested || this.restartTimer !== null) return;
    if (this.restartAttempts >= 6) {
      this.listeningRequested = false;
      this.callbacks.onState?.("idle");
      this.callbacks.onError?.("Voice connection could not be restored. Tap the microphone to try again.");
      return;
    }

    this.restartAttempts += 1;
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
    try { this.recognition?.stop(); } catch { /* already stopped */ }
    this.callbacks.onState?.("idle");
  }

  speak(text: string) {
    if (!("speechSynthesis" in window)) {
      this.callbacks.onError?.("Speech output is not supported by this browser.");
      return;
    }

    this.refreshVoice();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = this.selectedVoice;
    utterance.lang = this.selectedVoice?.lang || "en-IN";
    utterance.rate = 0.96;
    utterance.pitch = 1.08;
    utterance.volume = 1;
    utterance.onstart = () => this.callbacks.onState?.("speaking");
    utterance.onend = () => {
      if (this.listeningRequested) this.callbacks.onState?.("listening");
      else this.callbacks.onState?.("idle");
    };
    window.speechSynthesis.speak(utterance);
  }

  cancelSpeech() { window.speechSynthesis?.cancel(); }

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
  }
}
