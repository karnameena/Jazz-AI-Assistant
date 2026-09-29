(() => {
  const TTS_PATHS = new Set(["/api/tts", "/api/tts/stream"]);
  let voiceEnabled = false;

  const nativeFetch = window.fetch.bind(window);
  const synth = window.speechSynthesis || null;
  const nativeSpeak = synth?.speak?.bind(synth) || null;
  const nativeCancel = synth?.cancel?.bind(synth) || null;

  const isVoiceToggleOn = () => {
    const composerMic = document.querySelector(".composer-icon.voice-on");
    const headerMic = document.querySelector('.round-button.active[title*="voice" i]');
    return Boolean(composerMic || headerMic);
  };

  const syncVoiceMode = () => {
    const next = isVoiceToggleOn();
    if (next === voiceEnabled) return;
    voiceEnabled = next;
    document.documentElement.dataset.jazzVoiceMode = voiceEnabled ? "on" : "off";
    if (!voiceEnabled) nativeCancel?.();
  };

  document.documentElement.dataset.jazzVoiceMode = "off";

  window.__JAZZ_VOICE_MODE_GUARD__ = {
    isEnabled: () => voiceEnabled,
    sync: syncVoiceMode,
    forceOff: () => {
      voiceEnabled = false;
      document.documentElement.dataset.jazzVoiceMode = "off";
      nativeCancel?.();
    }
  };

  window.fetch = async (input, init) => {
    let url;
    try {
      url = new URL(
        typeof input === "string" ? input : input instanceof Request ? input.url : String(input),
        window.location.href
      );
    } catch {
      return nativeFetch(input, init);
    }

    if (url.origin === window.location.origin && TTS_PATHS.has(url.pathname) && !voiceEnabled) {
      return new Response(JSON.stringify({ ok: false, error: "Voice mode is off" }), {
        status: 409,
        headers: { "Content-Type": "application/json", "X-Jazz-Voice-Blocked": "1" }
      });
    }

    return nativeFetch(input, init);
  };

  if (synth && nativeSpeak) {
    try {
      synth.speak = utterance => {
        if (!voiceEnabled) {
          nativeCancel?.();
          return;
        }
        nativeSpeak(utterance);
      };
    } catch {
      // Some browsers may expose a non-writable method. Piper is still blocked above.
    }
  }

  const observer = new MutationObserver(syncVoiceMode);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "title"]
  });

  document.addEventListener("DOMContentLoaded", syncVoiceMode, { once: true });
  window.addEventListener("pageshow", () => {
    voiceEnabled = false;
    document.documentElement.dataset.jazzVoiceMode = "off";
    nativeCancel?.();
    queueMicrotask(syncVoiceMode);
  });

  console.info("[Jazz] Voice-mode guard active; TTS is blocked until the mic toggle is ON.");
})();
