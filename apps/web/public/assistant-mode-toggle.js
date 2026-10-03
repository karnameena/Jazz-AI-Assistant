(() => {
  const STORAGE_KEY = "jazz-assistant-mode-v1";
  const MODE_PREFIX = /^\[JAZZ_MODE:(?:NORMAL|EVIL)\]\s*/i;
  const evilActions = new Map([
    ["Take a Note", { label: "Nmap Scan", prompt: "Start an Nmap scan in my authorized ethical-hacking lab environment." }],
    ["Set Reminder", { label: "Metasploit", prompt: "Open the Metasploit workflow for my authorized ethical-hacking lab." }],
    ["Search Web", { label: "Burp Suite", prompt: "Open the Burp Suite workflow for my authorized ethical-hacking lab." }],
    ["Generate Image", { label: "Customize Script", prompt: "Help me customize a script for my authorized ethical-hacking lab." }]
  ]);

  let currentMode = localStorage.getItem(STORAGE_KEY) === "evil" ? "evil" : "normal";
  let observer = null;
  let observerRoot = null;
  let scheduledApply = 0;

  const modeCommandFor = value => {
    const text = String(value || "")
      .replace(MODE_PREFIX, "")
      .trim()
      .toLowerCase()
      .replace(/[.!?]+$/g, "")
      .replace(/\s+/g, " ");

    if (/^(?:hey |hi |hello )?(?:jazz[, ]+)?(?:please )?(?:change|switch|turn|move|set|go)(?: me)? (?:to |into )?(?:the )?(?:evil|ethical hack(?:ing)?(?: lab)?) mode$/.test(text)
      || /^(?:hey |hi |hello )?(?:jazz[, ]+)?(?:please )?(?:enable|activate|start) (?:the )?(?:evil|ethical hack(?:ing)?(?: lab)?) mode$/.test(text)
      || /^(?:hey |hi |hello )?(?:jazz[, ]+)?evil mode$/.test(text)) return "evil";

    if (/^(?:hey |hi |hello )?(?:jazz[, ]+)?(?:please )?(?:change|switch|turn|move|set|go)(?: me)? (?:to |into )?(?:the )?(?:normal|normal assist|assistant) mode$/.test(text)
      || /^(?:hey |hi |hello )?(?:jazz[, ]+)?(?:please )?(?:enable|activate|start) (?:the )?(?:normal|normal assist|assistant) mode$/.test(text)
      || /^(?:hey |hi |hello )?(?:jazz[, ]+)?normal mode$/.test(text)) return "normal";

    return null;
  };

  const setReactInputValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
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
      const span = button.querySelector("span");
      if (!span) continue;
      if (!button.dataset.normalLabel) button.dataset.normalLabel = span.textContent?.trim() || "";
      const normalLabel = button.dataset.normalLabel;
      const replacement = evilActions.get(normalLabel);
      const wanted = currentMode === "evil" && replacement ? replacement.label : normalLabel;
      if (span.textContent !== wanted) span.textContent = wanted;
      button.classList.toggle("evil-tool-action", currentMode === "evil" && !!replacement);
    }
  };

  const updateTabs = () => {
    document.querySelector(".mode-tabs")?.classList.add("jazz-mode-tabs-hidden");
    document.querySelector(".center-column")?.classList.add("jazz-mode-no-tabs");
  };

  const applyMode = () => {
    ensureToggle();
    const evil = currentMode === "evil";
    const app = document.querySelector(".jazz-app");
    app?.classList.toggle("jazz-evil-mode", evil);

    const wrap = document.querySelector(".jazz-mode-toggle-wrap");
    wrap?.classList.toggle("evil-active", evil);

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

  const scheduleApply = () => {
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
          const requestedMode = modeCommandFor(cleanMessage);
          if (requestedMode) setMode(requestedMode);

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
