(() => {
  if (window.__jazzAndroidCommandRouterInstalled) return;
  window.__jazzAndroidCommandRouterInstalled = true;

  const baseFetch = window.fetch.bind(window);
  const MODE_PREFIX = /^\s*\[JAZZ_MODE:(?:NORMAL|EVIL)\]\s*/i;

  const stripWake = value => String(value || "")
    .replace(MODE_PREFIX, "")
    .replace(/^\s*(?:hey\s+)?jazz[,\s:-]*/i, "")
    .trim();

  const isDirectAndroidCommand = value => {
    const text = stripWake(value);
    return [
      /^call\s+.+/i,
      /^(?:answer|answer\s+the\s+call|end(?:\s+the\s+call)?|hang\s+up)/i,
      /^(?:open|launch|start)\s+.+/i,
      /^close\s+.+/i,
      /^(?:go\s+)?back(?:\s+one\s+step)?[.!? ]*$/i,
      /^(?:go\s+)?home(?:\s+screen)?[.!? ]*$/i,
      /^(?:scroll|swipe)\s+(?:up|down|left|right)/i,
      /^(?:tap|click|press)\s+.+/i,
      /^long\s+press\s+.+/i,
      /^type\s+.+/i,
      /^clear\s+text/i,
      /^(?:open\s+)?notifications/i,
      /^(?:open\s+)?recent\s+apps/i,
      /^(?:(?:put|turn|switch)(?:\s+the)?\s+)?speaker(?:phone)?\s+(?:on|off)/i,
      /^(?:pause|play|resume|next\s+(?:song|track)|previous\s+(?:song|track)|increase\s+volume|decrease\s+volume|mute|unmute)/i,
      /^(?:turn\s+)?(?:the\s+)?flash(?:light)?\s+(?:on|off)/i,
      /^(?:message|whatsapp|whats\s*app|send\s+.+\s+this\s+message|send\s+.+\s+to\s+.+\s+on\s+whats\s*app)/i,
      /^unlock(?:\s+(?:my\s+)?(?:mobile|phone))?/i,
      /^(?:take\s+(?:a\s+)?screenshot|screenshot\s+(?:my\s+)?phone)/i,
      /\binstagram\b/i,
      /\byoutube\b/i,
      /\b(?:pay|send|transfer)\b[^,;\n]{0,90}?\b(?:my\s+)?(?:mom|momma|mummy)\b/i
    ].some(pattern => pattern.test(text));
  };

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
    const method = String(init?.method || (typeof input !== "string" && input?.method) || "GET").toUpperCase();
    const isChat = /\/api\/chat(?:\/stream)?(?:$|[?#])/i.test(url);

    if (!isChat || method !== "POST" || typeof init?.body !== "string") {
      return baseFetch(input, init);
    }

    try {
      const payload = JSON.parse(init.body);
      if (payload && typeof payload.message === "string" && isDirectAndroidCommand(payload.message)) {
        payload.message = payload.message.replace(MODE_PREFIX, "").trim();
        return baseFetch(input, { ...init, body: JSON.stringify(payload) });
      }
    } catch {
      // Leave non-JSON or malformed requests untouched.
    }

    return baseFetch(input, init);
  };
})();