(() => {
  const JAZZ_API_BASE = window.location.origin;
  const RECOVERY_BASE = "http://127.0.0.1:8799";
  const nativeFetch = window.fetch.bind(window);
  const CHAT_FLUSH_MS = 85;
  const encoder = new TextEncoder();

  const resolveTarget = input => {
    if (typeof input === "string" && input.startsWith("/api/")) return input;
    if (input instanceof URL && input.pathname.startsWith("/api/") && input.origin === window.location.origin) {
      return new URL(`${window.location.origin}${input.pathname}${input.search}`);
    }
    if (input instanceof Request) {
      const url = new URL(input.url, window.location.href);
      if (url.pathname.startsWith("/api/") && url.origin === window.location.origin) {
        return new Request(`${window.location.origin}${url.pathname}${url.search}`, input);
      }
    }
    return input;
  };

  const looksLikeRecoveryCommand = message => {
    const text = String(message || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!text) return false;
    return (
      /\b(?:where is|where's|locate|find|send me)\b.{0,40}\b(?:my )?(?:mobile|phone)\b/.test(text) ||
      /\b(?:mobile|phone) location\b/.test(text) ||
      /\b(?:take|capture)\b.{0,50}\b(?:front|rear)(?:-camera| camera)?\b.{0,50}\b(?:recovery )?photo\b/.test(text) ||
      /\b(?:latest|last)\b.{0,30}\brecovery photo\b/.test(text) ||
      /\bsend me\b.{0,30}\brecovery photo\b/.test(text) ||
      (/\bbattery(?: level)?\b/.test(text) && /\b(?:phone|mobile|lost)\b/.test(text)) ||
      /\b(?:is|whether)\b.{0,25}\b(?:my )?(?:phone|mobile)\b.{0,25}\bonline\b/.test(text) ||
      /\bphone online\b/.test(text) ||
      /\bring\b.{0,25}\b(?:my )?(?:phone|mobile)\b/.test(text) ||
      /\b(?:enable|disable)\b.{0,30}\blost device mode\b/.test(text) ||
      /\b(?:lost phone|device recovery|recovery status|refresh recovery)\b/.test(text)
    );
  };

  const requestBodyText = async (input, init) => {
    if (typeof init?.body === "string") return init.body;
    if (input instanceof Request) {
      try { return await input.clone().text(); } catch { return ""; }
    }
    return "";
  };

  const recoveryChatResponse = async (message, streaming) => {
    try {
      const response = await nativeFetch(`${RECOVERY_BASE}/api/recovery/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
      const data = await response.json();
      const assistant = data?.recognized
        ? (data.assistant || "Recovery command completed.")
        : "Jazz Device Recovery did not recognize that recovery command.";
      const payload = {
        ok: response.ok,
        assistant,
        mode: "device-recovery",
        recovery: data?.recovery || null,
        intent: data?.intent || null,
        recognized: Boolean(data?.recognized)
      };
      if (!response.ok) payload.assistant = data?.error || "Jazz Device Recovery is unavailable.";

      if (!streaming) {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
        });
      }

      const sse = [
        `event: meta\ndata: ${JSON.stringify({ mode: "device-recovery", streaming: false })}\n`,
        `event: text\ndata: ${JSON.stringify({ text: payload.assistant })}\n`,
        `event: done\ndata: ${JSON.stringify(payload)}\n`
      ].join("\n");
      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" }
      });
    } catch (error) {
      const assistant = `Jazz Device Recovery is not reachable on this PC. Start Jazz with start-jazz.ps1 and configure services/recovery-local/.env. ${error instanceof Error ? error.message : ""}`.trim();
      if (!streaming) {
        return new Response(JSON.stringify({ ok: true, assistant, mode: "device-recovery-unavailable" }), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
      const sse = [
        `event: meta\ndata: ${JSON.stringify({ mode: "device-recovery-unavailable" })}\n`,
        `event: text\ndata: ${JSON.stringify({ text: assistant })}\n`,
        `event: done\ndata: ${JSON.stringify({ assistant, mode: "device-recovery-unavailable" })}\n`
      ].join("\n");
      return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
    }
  };

  // Ollama can emit a token every few milliseconds. The React dashboard used to
  // re-render the entire page for every token, while multiple DOM observers and
  // smooth-scroll animations ran at the same time. Coalesce adjacent SSE text
  // events into one update roughly every 85 ms. This keeps streaming responsive
  // without changing the text or backend behavior.
  function coalesceChatStream(response) {
    if (!response?.ok || !response.body) return response;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let inputBuffer = "";
    let pendingText = "";
    let flushTimer = 0;
    let closed = false;

    const stream = new ReadableStream({
      start(controller) {
        const enqueueRaw = raw => {
          if (!closed && raw) controller.enqueue(encoder.encode(raw.endsWith("\n\n") ? raw : `${raw}\n\n`));
        };

        const flushText = () => {
          flushTimer = 0;
          if (!pendingText || closed) return;
          const text = pendingText;
          pendingText = "";
          enqueueRaw(`event: text\ndata: ${JSON.stringify({ text })}\n\n`);
        };

        const scheduleFlush = () => {
          if (flushTimer || closed) return;
          flushTimer = window.setTimeout(flushText, CHAT_FLUSH_MS);
        };

        const processEvent = rawEvent => {
          if (!rawEvent.trim()) return;
          let eventName = "";
          let dataRaw = "";
          for (const line of rawEvent.split(/\r?\n/)) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataRaw += line.slice(5).trim();
          }

          if (eventName === "text") {
            try {
              const data = JSON.parse(dataRaw || "{}");
              if (typeof data?.text === "string") {
                pendingText += data.text;
                if (pendingText.length >= 320) flushText();
                else scheduleFlush();
                return;
              }
            } catch {}
          }

          if (eventName === "done" || eventName === "error") flushText();
          enqueueRaw(`${rawEvent}\n\n`);
        };

        const pump = async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              inputBuffer += decoder.decode(value, { stream: true });
              const events = inputBuffer.split(/\r?\n\r?\n/);
              inputBuffer = events.pop() || "";
              for (const event of events) processEvent(event);
            }

            inputBuffer += decoder.decode();
            if (inputBuffer.trim()) processEvent(inputBuffer);
            if (flushTimer) {
              window.clearTimeout(flushTimer);
              flushTimer = 0;
            }
            flushText();
            closed = true;
            controller.close();
          } catch (error) {
            if (flushTimer) window.clearTimeout(flushTimer);
            closed = true;
            try { controller.error(error); } catch {}
          }
        };

        void pump();
      },
      cancel(reason) {
        closed = true;
        if (flushTimer) window.clearTimeout(flushTimer);
        return reader.cancel(reason).catch(() => undefined);
      }
    });

    const headers = new Headers(response.headers);
    headers.set("X-Jazz-Stream-Coalesced", "1");
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  window.fetch = async (input, init) => {
    const target = resolveTarget(input);
    const url = typeof target === "string" ? target : target instanceof Request ? target.url : target.toString();
    const resolvedUrl = new URL(url, window.location.href);
    const isChat = resolvedUrl.origin === window.location.origin && resolvedUrl.pathname === "/api/chat";
    const isChatStream = resolvedUrl.origin === window.location.origin && resolvedUrl.pathname === "/api/chat/stream";

    if (isChat || isChatStream) {
      const bodyText = await requestBodyText(input, init);
      try {
        const parsed = JSON.parse(bodyText || "{}");
        if (looksLikeRecoveryCommand(parsed?.message)) {
          return recoveryChatResponse(parsed.message, isChatStream);
        }
      } catch {}
    }

    try {
      const response = await nativeFetch(target, init);
      return isChatStream ? coalesceChatStream(response) : response;
    } catch (error) {
      const chatUrl = new URL("/api/chat", window.location.origin).toString();
      if (resolvedUrl.toString() === chatUrl) {
        return new Response(JSON.stringify({
          ok: true,
          assistant: "Jazz API is not reachable through the web server. Start Jazz with start-jazz.ps1 and try again.",
          mode: "api-unreachable"
        }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
      }
      throw error;
    }
  };

  window.__JAZZ_API_BASE__ = JAZZ_API_BASE;
  window.__JAZZ_RECOVERY_BASE__ = RECOVERY_BASE;
  window.__JAZZ_UI_PERF__ = { streamCoalescing: true, flushMs: CHAT_FLUSH_MS };
  console.info(`[Jazz] LAN-safe API router active through ${JAZZ_API_BASE}; chat stream batching=${CHAT_FLUSH_MS}ms; recovery commands use ${RECOVERY_BASE}`);
})();
