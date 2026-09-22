(() => {
  const API = "/telegram-api";
  let panel = null;
  let pollTimer = null;
  let chatOpen = false;
  let currentBot = null;

  const apiJson = async (path, options) => {
    const response = await fetch(`${API}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(data?.error || "Telegram request failed.");
    return data;
  };

  const formatTime = value => {
    try {
      return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  function enhanceQuickAction() {
    const buttons = Array.from(document.querySelectorAll("button.quick-action"));
    const translate = buttons.find(button => button.textContent?.trim() === "Translate");
    if (!translate || translate.dataset.jazzTelegramAction === "true") return;
    translate.dataset.jazzTelegramAction = "true";
    translate.title = "Open Telegram Bot inside Jazz";
    const label = translate.querySelector("span");
    if (label) label.textContent = "Telegram Bot";
    const svg = translate.querySelector("svg");
    if (svg) svg.setAttribute("data-jazz-telegram-icon", "true");
  }

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.className = "jazz-telegram-overlay";
    panel.hidden = true;
    panel.innerHTML = `
      <section class="jazz-telegram-panel" role="dialog" aria-modal="true" aria-label="Telegram Bot">
        <header class="jazz-telegram-header">
          <div class="jazz-telegram-title-wrap">
            <button class="jazz-telegram-back" type="button" aria-label="Back" hidden>‹</button>
            <div class="jazz-telegram-logo" aria-hidden="true">➤</div>
            <div>
              <strong class="jazz-telegram-title">Telegram Bot</strong>
              <small class="jazz-telegram-subtitle">Connected through Jazz</small>
            </div>
          </div>
          <div class="jazz-telegram-header-actions">
            <button class="jazz-telegram-refresh" type="button" title="Refresh">↻</button>
            <button class="jazz-telegram-close" type="button" title="Close">×</button>
          </div>
        </header>
        <div class="jazz-telegram-body">
          <div class="jazz-telegram-list-view">
            <div class="jazz-telegram-section-label">MY TELEGRAM BOTS</div>
            <div class="jazz-telegram-loading">Checking Telegram connection…</div>
            <div class="jazz-telegram-bot-list"></div>
            <div class="jazz-telegram-setup" hidden></div>
          </div>
          <div class="jazz-telegram-chat-view" hidden>
            <div class="jazz-telegram-messages"></div>
            <form class="jazz-telegram-composer">
              <input class="jazz-telegram-input" maxlength="4096" autocomplete="off" placeholder="Message through Jazz…" />
              <button class="jazz-telegram-send" type="submit" aria-label="Send">➤</button>
            </form>
          </div>
        </div>
      </section>`;
    document.body.appendChild(panel);

    panel.addEventListener("click", event => {
      if (event.target === panel) closePanel();
    });
    panel.querySelector(".jazz-telegram-close")?.addEventListener("click", closePanel);
    panel.querySelector(".jazz-telegram-back")?.addEventListener("click", showBotList);
    panel.querySelector(".jazz-telegram-refresh")?.addEventListener("click", () => chatOpen ? refreshMessages() : loadBotList());
    panel.querySelector(".jazz-telegram-composer")?.addEventListener("submit", sendMessage);
    return panel;
  }

  function showSetup(message) {
    const root = ensurePanel();
    root.querySelector(".jazz-telegram-loading").hidden = true;
    root.querySelector(".jazz-telegram-bot-list").innerHTML = "";
    const setup = root.querySelector(".jazz-telegram-setup");
    setup.hidden = false;
    setup.innerHTML = "";

    const heading = document.createElement("strong");
    heading.textContent = "Telegram is not configured yet";
    const body = document.createElement("p");
    body.textContent = message || "Add your bot token and Telegram chat ID, then restart Jazz.";
    const path = document.createElement("code");
    path.textContent = "services/api/.env";
    const vars = document.createElement("pre");
    vars.textContent = "JAZZ_TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN\nJAZZ_TELEGRAM_CHAT_ID=YOUR_TELEGRAM_CHAT_ID";
    setup.append(heading, body, path, vars);
  }

  async function loadBotList() {
    const root = ensurePanel();
    chatOpen = false;
    stopPolling();
    root.querySelector(".jazz-telegram-back").hidden = true;
    root.querySelector(".jazz-telegram-list-view").hidden = false;
    root.querySelector(".jazz-telegram-chat-view").hidden = true;
    root.querySelector(".jazz-telegram-title").textContent = "Telegram Bot";
    root.querySelector(".jazz-telegram-subtitle").textContent = "Connected through Jazz";
    root.querySelector(".jazz-telegram-loading").hidden = false;
    root.querySelector(".jazz-telegram-loading").textContent = "Checking Telegram connection…";
    root.querySelector(".jazz-telegram-setup").hidden = true;
    root.querySelector(".jazz-telegram-bot-list").innerHTML = "";

    try {
      const status = await apiJson("/status");
      if (!status.configured || !status.bot) {
        showSetup(status.message);
        return;
      }
      currentBot = status.bot;
      root.querySelector(".jazz-telegram-loading").hidden = true;
      const list = root.querySelector(".jazz-telegram-bot-list");
      const card = document.createElement("button");
      card.type = "button";
      card.className = "jazz-telegram-bot-card";

      const avatar = document.createElement("span");
      avatar.className = "jazz-telegram-bot-avatar";
      avatar.textContent = "➤";
      const copy = document.createElement("span");
      copy.className = "jazz-telegram-bot-copy";
      const name = document.createElement("strong");
      name.textContent = status.bot.firstName || "Telegram Bot";
      const username = document.createElement("small");
      username.textContent = status.bot.username ? `@${status.bot.username}` : "Telegram bot";
      const meta = document.createElement("em");
      meta.textContent = `Ready • Chat ${status.chatId || "configured"}`;
      copy.append(name, username, meta);
      const arrow = document.createElement("span");
      arrow.className = "jazz-telegram-card-arrow";
      arrow.textContent = "›";
      card.append(avatar, copy, arrow);
      card.addEventListener("click", openChat);
      list.appendChild(card);
    } catch (error) {
      showSetup(error instanceof Error ? error.message : "Could not connect to Telegram.");
    }
  }

  function renderMessages(items) {
    const root = ensurePanel();
    const container = root.querySelector(".jazz-telegram-messages");
    container.innerHTML = "";
    if (!Array.isArray(items) || items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "jazz-telegram-empty";
      empty.textContent = "No messages yet. Send a message here or message your bot in Telegram.";
      container.appendChild(empty);
      return;
    }

    for (const item of items) {
      const row = document.createElement("div");
      row.className = `jazz-telegram-message-row ${item.direction === "out" ? "out" : "in"}`;
      const bubble = document.createElement("div");
      bubble.className = "jazz-telegram-message";
      const text = document.createElement("div");
      text.textContent = item.text || "";
      const meta = document.createElement("small");
      meta.textContent = `${item.direction === "out" ? "Jazz" : item.from || "Telegram"} • ${formatTime(item.date)}`;
      bubble.append(text, meta);
      row.appendChild(bubble);
      container.appendChild(row);
    }
    container.scrollTop = container.scrollHeight;
  }

  async function refreshMessages() {
    if (!chatOpen) return;
    try {
      const data = await apiJson("/messages");
      renderMessages(data.items || []);
    } catch (error) {
      const root = ensurePanel();
      const container = root.querySelector(".jazz-telegram-messages");
      container.innerHTML = "";
      const errorBox = document.createElement("div");
      errorBox.className = "jazz-telegram-error";
      errorBox.textContent = error instanceof Error ? error.message : "Telegram refresh failed.";
      container.appendChild(errorBox);
    }
  }

  async function openChat() {
    const root = ensurePanel();
    chatOpen = true;
    root.querySelector(".jazz-telegram-back").hidden = false;
    root.querySelector(".jazz-telegram-list-view").hidden = true;
    root.querySelector(".jazz-telegram-chat-view").hidden = false;
    root.querySelector(".jazz-telegram-title").textContent = currentBot?.firstName || "Telegram Bot";
    root.querySelector(".jazz-telegram-subtitle").textContent = currentBot?.username ? `@${currentBot.username} • online` : "Telegram • online";
    await refreshMessages();
    startPolling();
    setTimeout(() => root.querySelector(".jazz-telegram-input")?.focus(), 50);
  }

  function showBotList() {
    void loadBotList();
  }

  async function sendMessage(event) {
    event.preventDefault();
    const root = ensurePanel();
    const input = root.querySelector(".jazz-telegram-input");
    const button = root.querySelector(".jazz-telegram-send");
    const text = input.value.trim();
    if (!text) return;
    button.disabled = true;
    input.disabled = true;
    try {
      await apiJson("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      input.value = "";
      await refreshMessages();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not send Telegram message.");
    } finally {
      button.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => void refreshMessages(), 4000);
  }

  function stopPolling() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = null;
  }

  function openPanel() {
    const root = ensurePanel();
    root.hidden = false;
    document.documentElement.classList.add("jazz-telegram-open");
    void loadBotList();
  }

  function closePanel() {
    if (!panel) return;
    panel.hidden = true;
    chatOpen = false;
    stopPolling();
    document.documentElement.classList.remove("jazz-telegram-open");
  }

  document.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest("button[data-jazz-telegram-action='true']") : null;
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    openPanel();
  }, true);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && panel && !panel.hidden) closePanel();
  });

  const observer = new MutationObserver(enhanceQuickAction);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enhanceQuickAction);
  else enhanceQuickAction();
})();
