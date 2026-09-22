(() => {
  function labelTelegramQuickAction() {
    const buttons = Array.from(document.querySelectorAll("button.quick-action"));
    const button = buttons.find(candidate => {
      const text = candidate.textContent?.trim() || "";
      return text === "Telegram" || text === "Telegram Bot";
    });
    if (!button) return false;

    button.title = "Open Telegram Bot inside Jazz";
    button.dataset.jazzTelegramAction = "true";
    const label = button.querySelector("span");
    if (label && label.textContent !== "Telegram Bot") label.textContent = "Telegram Bot";
    return true;
  }

  const start = () => {
    if (labelTelegramQuickAction()) return;
    const observer = new MutationObserver(() => {
      if (labelTelegramQuickAction()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
