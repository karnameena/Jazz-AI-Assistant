(() => {
  const STORAGE_KEY = "jazz-assistant-mode-v1";
  const MODE_PREFIX = /^\[JAZZ_MODE:(?:NORMAL|EVIL)\]\s*/i;

  const normalize = value => String(value || "")
    .replace(MODE_PREFIX, "")
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");

  const isModeQuestion = value => {
    const text = normalize(value);
    return /^(?:hey |hi |hello )?(?:jazz[, ]+)?(?:which|what) mode(?: now)? (?:are you|you are)(?: in)?$/.test(text)
      || /^(?:hey |hi |hello )?(?:jazz[, ]+)?(?:which|what) mode are you in$/.test(text)
      || /^(?:hey |hi |hello )?(?:jazz[, ]+)?what is your (?:current )?mode$/.test(text)
      || /^(?:hey |hi |hello )?(?:jazz[, ]+)?current mode$/.test(text);
  };

  const makeResponse = (url, reply, mode) => {
    const stream = /\/api\/chat\/stream(?:$|[?#])/i.test(url);
    if (stream) {
      const body = [
        `event: meta\ndata: ${JSON.stringify({ mode: "local-mode-control", assistantMode: mode })}\n`,
        `event: text\ndata: ${JSON.stringify({ text: reply })}\n`,
        `event: done\ndata: ${JSON.stringify({ assistant: reply, mode: "local-mode-control", assistantMode: mode })}\n`
      ].join("\n");
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" }
      });
    }

    return new Response(JSON.stringify({ ok: true, assistant: reply, mode: "local-mode-control", assistantMode: mode }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  };

  const install = () => {
    if (window.__jazzModeReplyCleanupInstalled) return;
    window.__jazzModeReplyCleanupInstalled = true;

    const baseFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
      const isChatRequest = /\/api\/chat(?:\/stream)?(?:$|[?#])/i.test(url);
      const method = String(init?.method || (typeof input !== "string" && input?.method) || "GET").toUpperCase();
      if (!isChatRequest || method !== "POST" || typeof init?.body !== "string") return baseFetch(input, init);

      try {
        const payload = JSON.parse(init.body);
        if (payload && typeof payload.message === "string" && isModeQuestion(payload.message)) {
          const mode = localStorage.getItem(STORAGE_KEY) === "evil" ? "evil" : "normal";
          const reply = mode === "evil"
            ? "I’m in Evil Ethical Hack Lab mode, Mama. 😈"
            : "I’m in Normal Assist mode, Mama. ✨";
          return makeResponse(url, reply, mode);
        }
      } catch {
        // Preserve the existing request path if the body is not JSON.
      }

      return baseFetch(input, init);
    };
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
