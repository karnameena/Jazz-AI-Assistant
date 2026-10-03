(() => {
  const previousFetch = window.fetch.bind(window);

  const normalizeText = value => String(value || "")
    .replace(/^\[JAZZ_MODE:(?:NORMAL|EVIL)\]\s*/i, "")
    .trim()
    .replace(/^\s*(?:hey\s+)?jazz[,\s:-]*/i, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+(?:hey\s+)?jazz$/i, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  const isEndCallPhrase = text => /^(?:hang\s*up|hangup|end|end\s+call|end\s+the\s+call|cut\s+call|cut\s+the\s+call|close\s+call|close\s+the\s+call|disconnect\s+call|disconnect\s+the\s+call|end\s+up)$/.test(text);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
    const isChatRequest = /\/api\/chat(?:\/stream)?(?:$|[?#])/i.test(url);
    const method = String(init?.method || (typeof input !== "string" && input?.method) || "GET").toUpperCase();

    if (!isChatRequest || method !== "POST" || typeof init?.body !== "string") {
      return previousFetch(input, init);
    }

    try {
      const payload = JSON.parse(init.body);
      if (payload && typeof payload.message === "string") {
        const normalized = normalizeText(payload.message);
        if (isEndCallPhrase(normalized)) {
          payload.message = "hang up";
          return previousFetch(input, { ...init, body: JSON.stringify(payload) });
        }
      }
    } catch {
      // Preserve the original request if parsing fails.
    }

    return previousFetch(input, init);
  };
})();
