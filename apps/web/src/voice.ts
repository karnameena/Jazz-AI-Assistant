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
  private preferredVoice: SpeechSynthesisVoice | null = null;

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

    if ("speechSynthesis" in window) {
      this.loadFriendlyFemaleVoice();
      window.speechSynthesis.addEventListener("voiceschanged", this.loadFriendlyFemaleVoice);
    }

    this.recognition.onstart = () => this.callbacks.onState?.("listening");
    this.recognition.onend = () => this.callbacks.onState?.("idle");
    this.recognition.onerror = (event: any) => {
      if (event?.error !== "aborted") {
        this.callbacks.onError?.(event?.error || "Voice recognition failed");
      }
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
  }

  isSupported() {
    return Boolean(this.recognition);
  }

  setWakePhraseEnabled(enabled: boolean) {
    this.wakeEnabled = enabled;
  }

  start() {
    if (!this.recognition) {
      this.callbacks.onError?.("Speech recognition is not supported by this browser.");
      return;
    }
    try {
      this.recognition.start();
    } catch {
      // Browsers throw when start() is called while recognition is already active.
    }
  }

  stop() {
    this.recognition?.stop();
  }

  speak(text: string) {
    if (!("speechSynthesis" in window)) {
      this.callbacks.onError?.("Speech output is not supported by this browser.");
      return;
    }

    window.speechSynthesis.cancel();
    this.loadFriendlyFemaleVoice();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-IN";
    utterance.rate = 0.96;
    utterance.pitch = 1.08;
    utterance.volume = 1;
    if (this.preferredVoice) utterance.voice = this.preferredVoice;

    utterance.onstart = () => this.callbacks.onState?.("speaking");
    utterance.onend = () => this.callbacks.onState?.("idle");
    utterance.onerror = () => this.callbacks.onState?.("idle");
    window.speechSynthesis.speak(utterance);
  }

  cancelSpeech() {
    window.speechSynthesis?.cancel();
  }

  private loadFriendlyFemaleVoice = () => {
    if (!("speechSynthesis" in window)) return;

    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;

    const english = voices.filter(voice => /^en(-|_)/i.test(voice.lang));
    const candidates = english.length ? english : voices;

    const preferredNames = [
      "Microsoft Jenny Online (Natural)",
      "Microsoft Jenny",
      "Microsoft Aria Online (Natural)",
      "Microsoft Aria",
      "Google UK English Female",
      "Google US English",
      "Samantha",
      "Karen",
      "Moira",
      "Tessa",
      "Zira"
    ];

    this.preferredVoice =
      candidates.find(voice => preferredNames.some(name => voice.name.toLowerCase() === name.toLowerCase())) ||
      candidates.find(voice => /female|woman|jenny|aria|samantha|karen|moira|tessa|zira/i.test(voice.name)) ||
      candidates.find(voice => /en[-_]IN/i.test(voice.lang)) ||
      candidates[0] ||
      null;
  };

  private stripWakePhrase(text: string) {
    if (!this.wakeEnabled) return text;
    const normalized = text.replace(/[,.!?]/g, "").trim();
    const wake = /^hey\s+jazz\b\s*/i;
    if (wake.test(normalized)) return normalized.replace(wake, "").trim();
    return normalized;
  }
}

declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}
