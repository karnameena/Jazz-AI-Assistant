(() => {
  const MODE_PREFIX = /^\[JAZZ_MODE:(?:NORMAL|EVIL)\]\s*/i;

  const normalize = value => String(value || "")
    .replace(MODE_PREFIX, "")
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");

  const cleanCommand = value => String(value || "").replace(MODE_PREFIX, "").trim();
  const stripWake = value => cleanCommand(value).replace(/^\s*(?:hey\s+)?jazz[,\s:-]*/i, "").trim();

  const currentMode = () => window.getJazzAssistantMode?.() === "evil" ? "evil" : "normal";

  const cleanModeReply = () => currentMode() === "evil"
    ? "I’m in Evil Ethical Hack Lab mode, Mama. 😈 What are we testing in your authorized lab?"
    : "I’m in Normal Assist mode, Mama. ✨ What do you need?";

  const cleanSwitchReply = mode => mode === "evil"
    ? "Evil Ethical Hack Lab mode active, Mama. 😈 What are we going to test in your authorized lab?"
    : "Normal Assist mode active, Mama. ✨ What do you need?";

  const cleanWakeReply = () => currentMode() === "evil"
    ? "Hey Mama 😈 Evil mode active. What are we going to ethically hack or test in your authorized lab?"
    : "Hey Mama 👋😎 Normal Assist mode active. I’m here and listening. What do you want me to do?";

  const detectModeSwitch = text => {
    if (/\b(?:change|switch|turn|move|set|go|enable|activate|start)\b.*\b(?:evil|ethical hack(?:ing)?(?: lab)?)\s+mode\b/.test(text)
      || /^(?:hey |hi |hello )?(?:jazz[, ]+)?evil mode$/.test(text)) return "evil";
    if (/\b(?:change|switch|turn|move|set|go|enable|activate|start)\b.*\b(?:normal|normal assist|assistant)\s+mode\b/.test(text)
      || /^(?:hey |hi |hello )?(?:jazz[, ]+)?normal mode$/.test(text)) return "normal";
    return null;
  };

  const isModeQuestion = text => /\b(?:what|which)\s+mode\b/.test(text)
    || /\bcurrent\s+mode\b/.test(text)
    || /\bwhat is your mode\b/.test(text);

  const isModelQuestion = text => /\b(?:what|which)\s+(?:ai\s+)?model\b/.test(text)
    || /\bmodel name\b/.test(text)
    || /\bwhat model are you\b/.test(text);

  const isWakeGreeting = text => /^(?:hey|hi|hello)(?:\s+jazz)?$/.test(text) || text === "jazz";

  const isDirectAndroidAction = value => {
    const text = stripWake(value);
    return [
      /^call\s+.+/i,
      /^(?:answer|answer\s+the\s+call|end(?:\s+the\s+call)?|hang\s+up)/i,
      /^(?:open|launch|start)\s+.+/i,
      /^close\s+.+/i,
      /^(?:go\s+)?(?:back|home)/i,
      /^(?:scroll|swipe)\s+(?:up|down|left|right)/i,
      /^(?:tap|click|press|long\s+press)\s+.+/i,
      /^type\s+.+/i,
      /^clear\s+text/i,
      /^(?:open\s+)?(?:notifications|recent\s+apps)/i,
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

  const localResponse = (url, reply) => {
    const stream = /\/api\/chat\/stream(?:$|[?#])/i.test(url);
    if (stream) {
      const body = [
        `event: meta\ndata: ${JSON.stringify({ mode: "local-mode-control", assistantMode: currentMode() })}\n`,
        `event: text\ndata: ${JSON.stringify({ text: reply })}\n`,
        `event: done\ndata: ${JSON.stringify({ assistant: reply, mode: "local-mode-control", assistantMode: currentMode() })}\n`
      ].join("\n");
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" }
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      assistant: reply,
      mode: "local-mode-control",
      assistantMode: currentMode()
    }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  };

  const directChatRequest = (url, payload) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    if (/\/api\/chat\/stream(?:$|[?#])/i.test(url)) xhr.setRequestHeader("Accept", "text/event-stream");
    xhr.onload = () => {
      const contentType = /\/api\/chat\/stream(?:$|[?#])/i.test(url)
        ? "text/event-stream; charset=utf-8"
        : "application/json; charset=utf-8";
      resolve(new Response(xhr.responseText, {
        status: xhr.status || 200,
        statusText: xhr.statusText || "OK",
        headers: { "Content-Type": contentType, "Cache-Control": "no-store" }
      }));
    };
    xhr.onerror = () => reject(new TypeError("Jazz API request failed"));
    xhr.ontimeout = () => reject(new TypeError("Jazz API request timed out"));
    xhr.timeout = 120000;
    xhr.send(JSON.stringify(payload));
  });

  const previousFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
    const isChatRequest = /\/api\/chat(?:\/stream)?(?:$|[?#])/i.test(url);
    const method = String(init?.method || (typeof input !== "string" && input?.method) || "GET").toUpperCase();
    if (!isChatRequest || method !== "POST" || typeof init?.body !== "string") return previousFetch(input, init);

    try {
      const payload = JSON.parse(init.body);
      if (payload && typeof payload.message === "string") {
        const text = normalize(payload.message);
        const switchTo = detectModeSwitch(text);
        if (switchTo) {
          window.setJazzAssistantMode?.(switchTo);
          return localResponse(url, cleanSwitchReply(switchTo));
        }
        if (isModeQuestion(text) || isModelQuestion(text)) return localResponse(url, cleanModeReply());
        if (isWakeGreeting(text)) return localResponse(url, cleanWakeReply());

        // Assistant-mode routing prefixes ordinary chat messages with [JAZZ_MODE:*].
        // Android intent matching expects commands such as "call Mom" to start at the
        // beginning of the utterance. Bypass the mode wrapper for real device actions
        // while keeping assistantMode metadata in the payload.
        if (isDirectAndroidAction(payload.message)) {
          payload.message = cleanCommand(payload.message);
          payload.assistantMode = currentMode();
          return directChatRequest(url, payload);
        }
      }
    } catch {
      // Preserve the existing Jazz request if parsing fails.
    }

    return previousFetch(input, init);
  };
})();