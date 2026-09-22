(() => {
  const NativeRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!NativeRecognition) return;

  const supportsLocal =
    typeof NativeRecognition.available === "function" &&
    typeof NativeRecognition.install === "function";

  const state = {
    supported: supportsLocal,
    mode: supportsLocal ? "checking" : "remote-only",
    language: null,
    requestedLanguage: null,
    lastAvailability: null,
    lastError: null
  };
  window.__JAZZ_LOCAL_STT__ = state;

  const emit = detail => {
    try {
      window.dispatchEvent(new CustomEvent("jazz-local-stt-status", { detail: { ...state, ...detail } }));
    } catch {}
  };

  // Current Chromium/Edge on-device speech models support en-US, but many Windows
  // machines report navigator.language as en-IN/en-GB. Normalize any English
  // request to en-US so Jazz does not silently fall back to remote STT.
  function localLanguage(requested) {
    const lang = String(requested || navigator.language || "en-US").replace("_", "-") || "en-US";
    return /^en(?:-|$)/i.test(lang) ? "en-US" : lang;
  }

  if (!supportsLocal) {
    state.lastError = "On-device SpeechRecognition API is not enabled in this browser.";
    console.info("[Jazz] On-device speech recognition API is unavailable; browser default recognition remains available.");
  }

  async function prepareLocalRecognition(recognition) {
    if (!supportsLocal) return false;

    const requested = String(recognition.lang || navigator.language || "en-US").replace("_", "-") || "en-US";
    const lang = localLanguage(requested);
    state.requestedLanguage = requested;
    state.language = lang;
    state.mode = "checking";
    emit({ mode: state.mode, requestedLanguage: requested, language: lang });

    try {
      const options = {
        langs: [lang],
        processLocally: true,
        quality: "command"
      };

      const availability = await NativeRecognition.available(options);
      state.lastAvailability = availability;

      if (availability === "available") {
        recognition.lang = lang;
        recognition.processLocally = true;
        state.mode = "local";
        state.lastError = null;
        console.info(`[Jazz] On-device speech recognition ready for ${lang}.`);
        emit({ mode: state.mode, availability });
        return true;
      }

      if (availability === "downloadable" || availability === "downloading") {
        state.mode = "installing";
        console.info(`[Jazz] Installing on-device speech language pack for ${lang}...`);
        emit({ mode: state.mode, availability });

        const installed = await NativeRecognition.install(options);
        if (installed) {
          recognition.lang = lang;
          recognition.processLocally = true;
          state.mode = "local";
          state.lastError = null;
          state.lastAvailability = "available";
          console.info(`[Jazz] On-device speech language pack installed for ${lang}.`);
          emit({ mode: state.mode, availability: "available" });
          return true;
        }
      }

      state.mode = "local-unavailable";
      state.lastError = `On-device speech model is unavailable for ${lang}.`;
      console.warn(`[Jazz] ${state.lastError}`);
      emit({ mode: state.mode, availability, error: state.lastError });
      return false;
    } catch (error) {
      state.mode = "local-error";
      state.lastError = error instanceof Error ? error.message : String(error);
      console.warn("[Jazz] Could not initialize on-device speech recognition.", error);
      emit({ mode: state.mode, error: state.lastError });
      return false;
    }
  }

  function JazzSpeechRecognition() {
    const recognition = new NativeRecognition();
    const nativeStart = recognition.start.bind(recognition);
    let starting = false;
    let localPrepared = false;

    return new Proxy(recognition, {
      get(target, property) {
        if (property === "start") {
          return () => {
            if (starting) return;
            if (localPrepared || target.processLocally === true) {
              nativeStart();
              return;
            }

            if (!supportsLocal) {
              nativeStart();
              return;
            }

            starting = true;
            void prepareLocalRecognition(target)
              .then(localReady => {
                if (localReady) {
                  localPrepared = true;
                  nativeStart();
                  return;
                }

                // Do not silently switch a local-first Jazz installation back to
                // Chromium's cloud recognizer. Leave the native recognizer stopped
                // so the UI can show the local-STT diagnostic instead of a misleading
                // generic network failure.
                try {
                  target.onerror?.({ error: "local-stt-unavailable" });
                } catch {}
              })
              .catch(error => {
                try {
                  target.onerror?.({ error: "local-stt-unavailable", message: String(error) });
                } catch {}
              })
              .finally(() => {
                starting = false;
              });
          };
        }

        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set(target, property, value) {
        return Reflect.set(target, property, value, target);
      }
    });
  }

  JazzSpeechRecognition.prototype = NativeRecognition.prototype;
  Object.setPrototypeOf(JazzSpeechRecognition, NativeRecognition);

  if (supportsLocal) {
    JazzSpeechRecognition.available = NativeRecognition.available.bind(NativeRecognition);
    JazzSpeechRecognition.install = NativeRecognition.install.bind(NativeRecognition);
  }

  window.SpeechRecognition = JazzSpeechRecognition;
  if (window.webkitSpeechRecognition) window.webkitSpeechRecognition = JazzSpeechRecognition;

  console.info("[Jazz] Local-first speech recognition bootstrap active.");
})();
