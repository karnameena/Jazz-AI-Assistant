(() => {
  const STORAGE_KEY = "jazz-assistant-mode-v1";
  const MODE_PREFIX = /^\[JAZZ_MODE:(?:NORMAL|EVIL)\]\s*/i;
  const DEVICE_RECOVERY_LABEL = "📱 DEVICE RECOVERY";
  const evilActions = new Map([
    ["Take a Note", { label: "Nmap Scan", prompt: "Start an Nmap scan in my authorized ethical-hacking lab environment.", icon: "nmap" }],
    ["Set Reminder", { label: "Metasploit", prompt: "Open the Metasploit workflow for my authorized ethical-hacking lab.", icon: "metasploit" }],
    ["Search Web", { label: "Burp Suite", prompt: "Open the Burp Suite workflow for my authorized ethical-hacking lab.", icon: "burp" }],
    ["Generate Image", { label: "Customize Script", prompt: "Help me customize a script for my authorized ethical-hacking lab.", icon: "script" }]
  ]);

  const toolIcons = {
    nmap: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2.3"/><circle cx="19" cy="6" r="2.3"/><circle cx="19" cy="18" r="2.3"/><path d="M7.2 11.1 16.8 6.9M7.2 12.9l9.6 4.2"/></svg>',
    metasploit: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3M12.5 15H17"/></svg>',
    burp: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4a13 13 0 0 1 0 16M12 4a13 13 0 0 0 0 16M7 8h4M13 16h4"/></svg>',
    script: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>',
    recovery: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 18.5h4M9 8.5l3-2 3 2v3.2c0 2.2-1.5 3.7-3 4.5-1.5-.8-3-2.3-3-4.5Z"/></svg>'
  };

  let currentMode = localStorage.getItem(STORAGE_KEY) === "evil" ? "evil" : "normal";
  let observer = null;
  let observerRoot = null;
  let scheduledApply = 0;

  const normalizeCommandText = value => String(value || "")
    .replace(MODE_PREFIX, "")
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");

  const modeCommandFor = value => {
    const text = normalizeCommandText(value);
    if (/^(?:hey |hi |hello )?(?:jazz[, ]+)?(?:please )?(?:change|switch|turn|move|set|go)(?: me)? (?:to |into )?(?:the )?(?:evil|ethical hack(?:ing)?(?: lab)?) mode$/.test(text)
      || /^(?:hey |hi |hello )?(?:jazz[, ]+)?(?:please )?(?:enable|activate|start) (?:the )?(?:evil|ethical hack(?:ing)?(?: lab)?) mode$/.test(text)
      || /^(?:hey |hi |hello )?(?:jazz[, ]+)?evil mode$/.test(text)) return "evil";

    if (/^(?:hey |hi |hello )?(?:jazz[, ]+)?(?:please )?(?:change|switch|turn|move|set|go)(?: me)? (?:to |into )?(?:the )?(?:normal|normal assist|assistant) mode$/.test(text)
      || /^(?:hey |hi |hello )?(?:jazz[, ]+)?(?:please )?(?:enable|activate|start) (?:the )?(?:normal|normal assist|assistant) mode$/.test(text)
      || /^(?:hey |hi |hello )?(?:jazz[, ]+)?normal mode$/.test(text)) return "normal";

    return null;
  };

  const isModeQuestion = value => {
    const text = normalizeCommandText(value);
    return /^(?:hey |hi |hello )?(?:jazz[, ]+)?(?:which|what) mode(?: now)? (?:are you|you are)(?: in)?$/.test(text)
      || /^(?:hey |hi |hello )?(?:jazz[, ]+)?(?:which|what) mode are you in$/.test(text)
      || /^(?:hey |hi |hello )?(?:jazz[, ]+)?what is your (?:current )?mode$/.test(text)
      || /^(?:hey |hi |hello )?(?:jazz[, ]+)?current mode$/.test(text);
  };

  const isWakeGreeting = value => /^(?:hey|hi|hello)(?:\s+jazz)?$/i.test(normalizeCommandText(value)) || /^jazz$/i.test(normalizeCommandText(value));

  const localModeReply = value => {
    const requestedMode = modeCommandFor(value);
    if (requestedMode) {
      setMode(requestedMode);
      return requestedMode === "evil"
        ? "Evil Ethical Hack Lab mode active, Mama. 😈 Dolphin Phi is now the active local model. What are we going to test in your authorized lab?"
        : "Normal Assist mode active, Mama. ✨ Qwen 3 0.6B is now the active local model. What do you need?";
    }

    if (isModeQuestion(value)) {
      return currentMode === "evil"
        ? "I’m in Evil Ethical Hack Lab mode, Mama. 😈 My active local model is dolphin-phi:2.7b-v2.6-q2_K."
        : "I’m in Normal Assist mode, Mama. ✨ My active local model is qwen3:0.6b.";
    }

    if (isWakeGreeting(value)) {
      return currentMode === "evil"
        ? "Hey Mama 😈 Evil mode active. What are we going to ethically hack or test in your authorized lab?"
        : "Hey Mama 👋😎 Normal Assist mode active. I’m here and listening. What do you want me to do?";
    }

    return null;
  };

  const setReactInputValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  };

  const setButtonIcon = (button, iconName) => {
    const wanted = iconName || "";
    if ((button.dataset.jazzModeIcon || "") === wanted) return;
    button.dataset.jazzModeIcon = wanted;
    button.querySelector(":scope > .jazz-mode-tool-icon")?.remove();
    button.classList.toggle("jazz-custom-action-icon", Boolean(iconName));
    if (!iconName || !toolIcons[iconName]) return;
    const icon = document.createElement("span");
    icon.className = "jazz-mode-tool-icon";
    icon.innerHTML = toolIcons[iconName];
    button.prepend(icon);
  };

  const ensureToggle = () => {
    const header = document.querySelector(".top-header");
    if (!header) return;
    let wrap = document.querySelector(".jazz-mode-toggle-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "jazz-mode-toggle-wrap";
      wrap.innerHTML = `
        <div class="jazz-mode-toggle" role="group" aria-label="Jazz assistant mode">
          <button type="button" class="normal" data-jazz-mode="normal" aria-pressed="true"><span class="mode-symbol">✦</span><span>Normal</span></button>
          <button type="button" class="evil" data-jazz-mode="evil" aria-pressed="false"><span class="mode-symbol">♈</span><span>Evil</span></button>
        </div>`;
      header.style.position = "relative";
      header.appendChild(wrap);
      wrap.addEventListener("click", event => {
        const button = event.target.closest("[data-jazz-mode]");
        if (!button) return;
        setMode(button.dataset.jazzMode === "evil" ? "evil" : "normal");
      });
    }
  };

  const ensureStatus = () => {
    const greeting = document.querySelector(".greeting");
    if (!greeting) return;
    const old = greeting.querySelector("p:not(.jazz-mode-status)");
    if (old && old.style.display !== "none") old.style.display = "none";

    let status = greeting.querySelector(".jazz-mode-status");
    if (!status) {
      status = document.createElement("p");
      status.className = "jazz-mode-status";
      greeting.appendChild(status);
    }

    const evil = currentMode === "evil";
    status.classList.toggle("evil", evil);
    status.classList.toggle("normal", !evil);
    const html = evil
      ? `Jazz is <b>online</b> • ethical hack lab mode active`
      : `Jazz is <b>online</b> • normal assist mode active`;
    if (status.innerHTML !== html) status.innerHTML = html;
  };

  const updateQuickActions = () => {
    const buttons = document.querySelectorAll(".quick-action");
    for (const button of buttons) {
      const span = button.querySelector(":scope > span:last-child");
      if (!span) continue;

      const visibleLabel = span.textContent?.trim() || "";
      if (!button.dataset.normalLabel) {
        button.dataset.normalLabel = visibleLabel === "Open Calculator" || visibleLabel === "Device Recovery" || visibleLabel === DEVICE_RECOVERY_LABEL
          ? DEVICE_RECOVERY_LABEL
          : visibleLabel;
      }

      if (button.dataset.normalLabel === "Open Calculator") button.dataset.normalLabel = DEVICE_RECOVERY_LABEL;
      const normalLabel = button.dataset.normalLabel;

      if (normalLabel === DEVICE_RECOVERY_LABEL) {
        if (span.textContent !== DEVICE_RECOVERY_LABEL) span.textContent = DEVICE_RECOVERY_LABEL;
        button.classList.remove("evil-tool-action");
        button.dataset.evilIcon = "";
        setButtonIcon(button, "recovery");
        continue;
      }

      const replacement = evilActions.get(normalLabel);
      const evilAction = currentMode === "evil" && Boolean(replacement);
      const wanted = evilAction ? replacement.label : normalLabel;
      if (span.textContent !== wanted) span.textContent = wanted;
      button.classList.toggle("evil-tool-action", evilAction);
      button.dataset.evilIcon = evilAction ? replacement.icon : "";
      setButtonIcon(button, evilAction ? replacement.icon : null);
    }
  };

  const updateTabs = () => {
    document.querySelector(".mode-tabs")?.classList.add("jazz-mode-tabs-hidden");
    document.querySelector(".center-column")?.classList.add("jazz-mode-no-tabs");
  };

  const applyMode = () => {
    ensureToggle();
    const evil = currentMode === "evil";
    document.querySelector(".jazz-app")?.classList.toggle("jazz-evil-mode", evil);
    document.querySelector(".jazz-mode-toggle-wrap")?.classList.toggle("evil-active", evil);

    document.querySelectorAll("[data-jazz-mode]").forEach(button => {
      const active = button.dataset.jazzMode === currentMode;
      button.classList.toggle("active", active);
      if (button.getAttribute("aria-pressed") !== String(active)) button.setAttribute("aria-pressed", String(active));
    });

    ensureStatus();
    updateQuickActions();
    updateTabs();
  };

  const observe = () => {
    if (!observer || !observerRoot) return;
    observer.observe(observerRoot, { childList: true, subtree: true });
  };

  const mutationNeedsApply = mutations => {
    if (!document.querySelector(".jazz-mode-toggle-wrap")) return true;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes || []) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.(".top-header,.quick-action,.quick-actions-grid,.mode-tabs,.center-column,.greeting")
          || node.querySelector?.(".top-header,.quick-action,.quick-actions-grid,.mode-tabs,.center-column,.greeting")) return true;
      }
    }
    return false;
  };

  const scheduleApply = mutations => {
    if (!mutationNeedsApply(mutations || [])) return;
    if (scheduledApply) return;
    scheduledApply = requestAnimationFrame(() => {
      scheduledApply = 0;
      observer?.disconnect();
      applyMode();
      observe();
    });
  };

  function setMode(nextMode, { persist = true } = {}) {
    const next = nextMode === "evil" ? "evil" : "normal";
    const changed = currentMode !== next;
    currentMode = next;
    if (persist) localStorage.setItem(STORAGE_KEY, currentMode);
    observer?.disconnect();
    applyMode();
    observe();
    if (changed) {
      window.dispatchEvent(new CustomEvent("jazz-assistant-mode-changed", { detail: { mode: currentMode } }));
      console.info(`[Jazz] Assistant mode changed to ${currentMode}`);
    }
    return currentMode;
  }

  window.setJazzAssistantMode = mode => setMode(mode);
  window.getJazzAssistantMode = () => currentMode;

  const makeLocalChatResponse = (url, reply) => {
    const stream = /\/api\/chat\/stream(?:$|[?#])/i.test(url);
    if (stream) {
      const body = [
        `event: meta\ndata: ${JSON.stringify({ mode: "local-mode-control", assistantMode: currentMode })}\n`,
        `event: text\ndata: ${JSON.stringify({ text: reply })}\n`,
        `event: done\ndata: ${JSON.stringify({ assistant: reply, mode: "local-mode-control", assistantMode: currentMode })}\n`
      ].join("\n");
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" } });
    }
    return new Response(JSON.stringify({ ok: true, assistant: reply, mode: "local-mode-control", assistantMode: currentMode }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  };

  const installChatModeRouter = () => {
    if (window.__jazzModeFetchRouterInstalled) return;
    window.__jazzModeFetchRouterInstalled = true;
    const baseFetch = window.fetch.bind(window);

    window.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
      const isChatRequest = /\/api\/chat(?:\/stream)?(?:$|[?#])/i.test(url);
      const method = String(init?.method || (typeof input !== "string" && input?.method) || "GET").toUpperCase();
      if (!isChatRequest || method !== "POST" || typeof init?.body !== "string") return baseFetch(input, init);

      try {
        const payload = JSON.parse(init.body);
        if (payload && typeof payload.message === "string") {
          const cleanMessage = payload.message.replace(MODE_PREFIX, "").trim();
          const localReply = localModeReply(cleanMessage);
          if (localReply) return makeLocalChatResponse(url, localReply);

          // Critical: the backend routes Create PDF/Word/Excel commands before
          // the coding agent. Do not prefix these with [JAZZ_MODE:NORMAL/EVIL]
          // because older backend document parsers require a leading verb.
          // Preserve assistantMode metadata and all other mode-dependent chat.
          const documentCommand = /^(?:(?:hey\s+jazz[,!]?\s*)|(?:please\s+))*(?:create|generate|make|prepare|write|export|build)\b/i.test(cleanMessage)
            && /\b(?:pdf|word|docx|excel|xlsx|spreadsheet)\b/i.test(cleanMessage.slice(0, 170));
          if (documentCommand) {
            payload.message = cleanMessage;
            payload.assistantMode = currentMode;
            return baseFetch(input, { ...init, body: JSON.stringify(payload) });
          }

          const prefix = currentMode === "evil" ? "[JAZZ_MODE:EVIL]" : "[JAZZ_MODE:NORMAL]";
          payload.message = `${prefix} ${cleanMessage}`.trim();
          payload.assistantMode = currentMode;
          return baseFetch(input, { ...init, body: JSON.stringify(payload) });
        }
      } catch {
        // Keep the existing request untouched if it is not JSON.
      }
      return baseFetch(input, init);
    };
  };

  document.addEventListener("click", event => {
    if (currentMode !== "evil") return;
    const button = event.target.closest(".quick-action.evil-tool-action");
    if (!button) return;
    const original = button.dataset.normalLabel || "";
    const replacement = evilActions.get(original);
    if (!replacement) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const input = document.querySelector(".composer input");
    if (input) setReactInputValue(input, replacement.prompt);
  }, true);

  const start = () => {
    installChatModeRouter();
    observerRoot = document.getElementById("root");
    observer = new MutationObserver(scheduleApply);
    applyMode();
    observe();
    console.info(`[Jazz] Assistant mode router active: ${currentMode}`);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();