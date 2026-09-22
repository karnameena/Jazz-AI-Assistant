(() => {
  const NativeRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!NativeRecognition) return;

  // Jazz previously forced Chromium's on-device en-US recognizer for every English
  // speaker. On some Windows systems that hears the microphone but repeatedly emits
  // `nomatch`, especially when the browser/Windows language is en-IN or another
  // English locale. Use the browser's normal recognizer by default and preserve the
  // language selected by voice.ts instead of rewriting it to en-US.
  const state = {
    supported: true,
    mode: "browser",
    language: String(navigator.language || "en-US").replace("_", "-"),
    lastError: null,
    recognitionActive: false
  };
  window.__JAZZ_LOCAL_STT__ = state;

  const emit = detail => {
    try {
      Object.assign(state, detail || {});
      window.dispatchEvent(new CustomEvent("jazz-local-stt-status", { detail: { ...state } }));
    } catch {}
  };

  // SpeechRecognition already owns the microphone while it is listening. Opening a
  // second getUserMedia stream for the orb analyser can make Chromium report
  // `nomatch` even though audio is visibly arriving. Block only that second capture;
  // the initial permission probe still runs before recognition starts.
  const mediaDevices = navigator.mediaDevices;
  const nativeGetUserMedia = mediaDevices?.getUserMedia?.bind(mediaDevices);
  if (mediaDevices && nativeGetUserMedia) {
    mediaDevices.getUserMedia = async constraints => {
      const wantsAudio = Boolean(
        constraints && typeof constraints === "object" && "audio" in constraints && constraints.audio
      );

      if (state.recognitionActive && wantsAudio) {
        throw new DOMException(
          "Jazz SpeechRecognition currently owns the microphone.",
          "NotReadableError"
        );
      }

      return nativeGetUserMedia(constraints);
    };
  }

  function JazzSpeechRecognition() {
    const recognition = new NativeRecognition();
    const nativeStart = recognition.start.bind(recognition);
    const nativeStop = recognition.stop?.bind(recognition);
    const nativeAbort = recognition.abort?.bind(recognition);

    recognition.addEventListener?.("start", () => {
      state.recognitionActive = true;
      state.mode = "browser";
      state.language = String(recognition.lang || navigator.language || "en-US").replace("_", "-");
      state.lastError = null;
      emit({ recognitionActive: true, mode: "browser", language: state.language, lastError: null });
    });

    recognition.addEventListener?.("end", () => {
      state.recognitionActive = false;
      emit({ recognitionActive: false });
    });

    recognition.addEventListener?.("error", event => {
      state.lastError = String(event?.error || "unknown");
      emit({ lastError: state.lastError });
    });

    return new Proxy(recognition, {
      get(target, property) {
        if (property === "start") {
          return () => {
            state.recognitionActive = true;
            emit({ recognitionActive: true });
            try {
              return nativeStart();
            } catch (error) {
              state.recognitionActive = false;
              emit({
                recognitionActive: false,
                lastError: error instanceof Error ? error.message : String(error)
              });
              throw error;
            }
          };
        }

        if (property === "stop" && nativeStop) {
          return () => {
            state.recognitionActive = false;
            emit({ recognitionActive: false });
            return nativeStop();
          };
        }

        if (property === "abort" && nativeAbort) {
          return () => {
            state.recognitionActive = false;
            emit({ recognitionActive: false });
            return nativeAbort();
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

  // Preserve static capabilities exposed by newer Chromium builds without forcing
  // Jazz into local-only recognition.
  if (typeof NativeRecognition.available === "function") {
    JazzSpeechRecognition.available = NativeRecognition.available.bind(NativeRecognition);
  }
  if (typeof NativeRecognition.install === "function") {
    JazzSpeechRecognition.install = NativeRecognition.install.bind(NativeRecognition);
  }

  window.SpeechRecognition = JazzSpeechRecognition;
  if (window.webkitSpeechRecognition) window.webkitSpeechRecognition = JazzSpeechRecognition;

  console.info(`[Jazz] Speech recognition reliability guard active (${state.language}).`);
})();
