(() => {
  const normalize = value => String(value || "")
    .replace(/^\[JAZZ_MODE:(?:NORMAL|EVIL)\]\s*/i, "")
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");

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
      }
    } catch {
      // Preserve the existing Jazz request if parsing fails.
    }

    return previousFetch(input, init);
  };
})();