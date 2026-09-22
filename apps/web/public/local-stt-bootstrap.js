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
    lastAvailability: null,
    lastError: null
  };
  window.__JAZZ_LOCAL_STT__ = state;

  if (!supportsLocal) {
    console.info("[Jazz] Browser on-device speech recognition API is unavailable; using browser default recognition.");
    return;
  }

  const emit = detail => {
    try {
      window.dispatchEvent(new CustomEvent("jazz-local-stt-status", { detail: { ...state, ...detail } }));
    } catch {}
  };

  async function prepareLocalRecognition(recognition) {
    const lang = String(recognition.lang || navigator.language || "en-US").replace("_", "-") || "en-US";
    state.language = lang;
    state.mode = "checking";
    emit({ mode: state.mode, language: lang });

    try {
      const availability = await NativeRecognition.available({
        langs: [lang],
        processLocally: true
      });
      state.lastAvailability = availability;

      if (availability === "available") {
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

        const installed = await NativeRecognition.install({
          langs: [lang],
          processLocally: true
        });

        if (installed) {
          recognition.processLocally = true;
          state.mode = "local";
          state.lastError = null;
          console.info(`[Jazz] On-device speech language pack installed for ${lang}.`);
          emit({ mode: state.mode, availability: "available" });
          return true;
        }
      }

      recognition.processLocally = false;
      state.mode = "remote-fallback";
      console.warn(`[Jazz] On-device speech recognition is unavailable for ${lang}; browser remote recognition will be used.`);
      emit({ mode: state.mode, availability });
      return false;
    } catch (error) {
      recognition.processLocally = false;
      state.mode = "remote-fallback";
      state.lastError = error instanceof Error ? error.message : String(error);
      console.warn("[Jazz] Could not initialize on-device speech recognition; using browser fallback.", error);
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

            starting = true;
            void prepareLocalRecognition(target)
              .then(localReady => {
                if (localReady) localPrepared = true;
                nativeStart();
              })
              .catch(() => nativeStart())
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

  // Preserve access to the static on-device helpers for debugging/feature checks.
  JazzSpeechRecognition.available = NativeRecognition.available.bind(NativeRecognition);
  JazzSpeechRecognition.install = NativeRecognition.install.bind(NativeRecognition);

  window.SpeechRecognition = JazzSpeechRecognition;
  if (window.webkitSpeechRecognition) window.webkitSpeechRecognition = JazzSpeechRecognition;

  console.info("[Jazz] Local-first speech recognition bootstrap active.");
})();
