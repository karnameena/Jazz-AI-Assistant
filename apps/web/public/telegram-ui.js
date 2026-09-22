(() => {
  function labelTelegramQuickAction() {
    const buttons = Array.from(document.querySelectorAll("button.quick-action"));
    const button = buttons.find(candidate => {
      const text = candidate.textContent?.trim() || "";
      return text === "Telegram" || text === "Telegram Bot";
    });
    if (!button) return;

    button.title = "Open Telegram Bot inside Jazz";
    const label = button.querySelector("span");
    if (label && label.textContent !== "Telegram Bot") label.textContent = "Telegram Bot";
  }

  const observer = new MutationObserver(labelTelegramQuickAction);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", labelTelegramQuickAction, { once: true });
  } else {
    labelTelegramQuickAction();
  }
})();
