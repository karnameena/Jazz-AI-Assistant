(() => {
  const REFRESH_MS = 3000;
  let lastSignature = "";
  let timer = 0;

  const findCard = title => {
    for (const card of document.querySelectorAll(".right-column .dashboard-card")) {
      const heading = card.querySelector(".card-heading strong")?.textContent?.trim();
      if (heading === title) return card;
    }
    return null;
  };

  const deviceIcon = () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "17");
    svg.setAttribute("height", "17");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.innerHTML = '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"></rect><path d="M12 18h.01"></path>';
    return svg;
  };

  const focusDevicesCard = () => {
    const card = findCard("Devices");
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    card.animate?.(
      [
        { boxShadow: "0 0 0 0 rgba(91,205,255,0)" },
        { boxShadow: "0 0 0 2px rgba(91,205,255,.45),0 0 24px rgba(91,205,255,.22)" },
        { boxShadow: "0 0 0 0 rgba(91,205,255,0)" }
      ],
      { duration: 900, easing: "ease-out" }
    );
  };

  const render = items => {
    const card = findCard("Quick Actions");
    const grid = card?.querySelector(".quick-actions-grid");
    if (!grid) return false;

    const connected = (Array.isArray(items) ? items : [])
      .filter(device => device?.kind === "android" && (device?.connected === true || device?.status === "connected"))
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));

    const signature = connected.map(device => `${device.id}:${device.status}:${device.serial || ""}`).join("|");
    const existing = [...grid.querySelectorAll("[data-jazz-discovered-device]")];
    if (signature === lastSignature && existing.length === connected.length) return true;
    lastSignature = signature;
    existing.forEach(node => node.remove());

    for (const device of connected) {
      const button = document.createElement("button");
      button.className = "quick-action jazz-discovered-device-action";
      button.dataset.jazzDiscoveredDevice = device.id;
      button.title = device.serial ? `${device.name} connected via ${device.serial}` : `${device.name} connected`;
      button.appendChild(deviceIcon());

      const label = document.createElement("span");
      label.textContent = `${device.name} • Online`;
      button.appendChild(label);

      const dot = document.createElement("i");
      dot.setAttribute("aria-hidden", "true");
      dot.style.cssText = "position:absolute;right:8px;top:8px;width:7px;height:7px;border-radius:50%;background:#2ce291;box-shadow:0 0 8px rgba(44,226,145,.75)";
      button.style.position = "relative";
      button.appendChild(dot);
      button.addEventListener("click", focusDevicesCard);
      grid.appendChild(button);
    }
    return true;
  };

  const refresh = async () => {
    try {
      const response = await fetch("/api/devices", { cache: "no-store" });
      const data = await response.json();
      if (response.ok) render(data?.items || []);
    } catch {}
  };

  const schedule = () => {
    if (timer) window.clearInterval(timer);
    timer = window.setInterval(() => void refresh(), REFRESH_MS);
  };

  const observer = new MutationObserver(() => {
    if (!document.querySelector("[data-jazz-discovered-device]")) void refresh();
  });

  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true });
    void refresh();
    schedule();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.addEventListener("focus", () => void refresh());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refresh();
  });

  window.__JAZZ_DEVICE_DISCOVERY_UI__ = { refresh, refreshMs: REFRESH_MS };
})();
