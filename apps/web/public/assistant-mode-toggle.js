(() => {
  const STORAGE_KEY = "jazz-assistant-mode-v1";
  const NORMAL_STATUS = "Jazz is online • normal assist mode active";
  const EVIL_STATUS = "Jazz is online • ethical hack lab mode active";
  const MODE_PREFIX = /^\[JAZZ_MODE:(?:NORMAL|EVIL)\]\s*/i;
  const evilActions = new Map([
    ["Take a Note", { label: "Nmap Scan", prompt: "Start an Nmap scan in my authorized ethical-hacking lab environment." }],
    ["Set Reminder", { label: "Metasploit", prompt: "Open the Metasploit workflow for my authorized ethical-hacking lab." }],
    ["Search Web", { label: "Burp Suite", prompt: "Open the Burp Suite workflow for my authorized ethical-hacking lab." }],
    ["Generate Image", { label: "Customize Script", prompt: "Help me customize a script for my authorized ethical-hacking lab." }]
  ]);
  let currentMode = localStorage.getItem(STORAGE_KEY) === "evil" ? "evil" : "normal";

  const setReactInputValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
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
        currentMode = button.dataset.jazzMode === "evil" ? "evil" : "normal";
        localStorage.setItem(STORAGE_KEY, currentMode);
        applyMode();
      });
    }
  };

  const ensureStatus = () => {
    const greeting = document.querySelector(".greeting");
    if (!greeting) return;
    const old = greeting.querySelector("p:not(.jazz-mode-status)");
    if (old) old.style.display = "none";
    let status = greeting.querySelector(".jazz-mode-status");
    if (!status) {
      status = document.createElement("p");
      status.className = "jazz-mode-status";
      greeting.appendChild(status);
    }
    status.classList.toggle("evil", currentMode === "evil");
    status.classList.toggle("normal", currentMode === "normal");
    status.innerHTML = currentMode === "evil"
      ? `Jazz is <b>online</b> • ethical hack lab mode active`
      : `Jazz is <b>online</b> • normal assist mode active`;
  };

  const updateQuickActions = () => {
    const buttons = [...document.querySelectorAll(".quick-action")];
    for (const button of buttons) {
      const span = button.querySelector("span");
      if (!span) continue;
      if (!button.dataset.normalLabel) button.dataset.normalLabel = span.textContent?.trim() || "";
      const normalLabel = button.dataset.normalLabel;
      const replacement = evilActions.get(normalLabel);
      span.textContent = currentMode === "evil" && replacement ? replacement.label : normalLabel;
      button.classList.toggle("evil-tool-action", currentMode === "evil" && !!replacement);
    }
  };

  const updateTabs = () => {
    const tabs = document.querySelector(".mode-tabs");
    const center = document.querySelector(".center-column");
    if (tabs) tabs.classList.add("jazz-mode-tabs-hidden");
    if (center) center.classList.add("jazz-mode-no-tabs");
  };

  const applyMode = () => {
    ensureToggle();
    const app = document.querySelector(".jazz-app");
    app?.classList.toggle("jazz-evil-mode", currentMode === "evil");
    const wrap = document.querySelector(".jazz-mode-toggle-wrap");
    wrap?.classList.toggle("evil-active", currentMode === "evil");
    document.querySelectorAll("[data-jazz-mode]").forEach(button => {
      const active = button.dataset.jazzMode === currentMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    ensureStatus();
    updateQuickActions();
    updateTabs();
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

  const observer = new MutationObserver(() => applyMode());
  const start = () => {
    installChatModeRouter();
    applyMode();
    const root = document.getElementById("root");
    if (root) observer.observe(root, { childList: true, subtree: true });
    console.info(`[Jazz] Assistant mode router active: ${currentMode}`);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
