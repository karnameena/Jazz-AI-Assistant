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
    this.recognition.continuous = false;

    this.recognition.onstart = () => this.callbacks.onState?.("listening");
    this.recognition.onend = () => this.callbacks.onState?.("idle");
    this.recognition.onerror = (event: any) => {
      if (event?.error !== "aborted") this.callbacks.onError?.(event?.error || "Voice recognition failed");
      this.callbacks.onState?.("idle");
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
    if ("speechSynthesis" in window) window.speechSynthesis.addEventListener("voiceschanged", () => this.refreshVoice());
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
      this.callbacks.onError?.("Speech recognition is not supported by this browser.");
      return;
    }
    try { this.recognition.start(); } catch { /* recognition is already active */ }
  }

  stop() { this.recognition?.stop(); }

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
    utterance.onend = () => this.callbacks.onState?.("idle");
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
