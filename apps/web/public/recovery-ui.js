(() => {
  const RECOVERY_BASE = window.__JAZZ_RECOVERY_BASE__ || "http://127.0.0.1:8799";
  const POLL_MS = 900;
  let overlay = null;
  let pollTimer = 0;
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  const safeDate = value => {
    if (!value) return "Unknown";
    const date = typeof value === "number" ? new Date(value) : new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
  };

  function sendThroughJazz(text) {
    const input = document.querySelector(".composer input");
    const send = document.querySelector(".send-button");
    if (!(input instanceof HTMLInputElement) || !(send instanceof HTMLButtonElement)) return false;
    nativeInputValueSetter?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    window.setTimeout(() => send.click(), 40);
    return true;
  }

  async function recoveryFetch(path, options) {
    const response = await fetch(`${RECOVERY_BASE}${path}`, options);
    const data = await response.json();
    if (!response.ok || data?.ok === false) throw new Error(data?.error || "Recovery request failed");
    return data;
  }

  function metric(label, value, className = "") {
    const box = document.createElement("div");
    box.className = "jazz-recovery-metric";
    const l = document.createElement("span"); l.textContent = label;
    const v = document.createElement("strong"); v.className = className; v.textContent = value ?? "Unknown";
    box.append(l, v);
    return box;
  }

  function actionButton(label, command) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      if (sendThroughJazz(command)) closePanel();
    });
    return button;
  }

  function renderActions(panel, data = null) {
    const actions = panel?.querySelector(".jazz-recovery-actions");
    if (!actions) return;
    actions.textContent = "";
    const lostModeOn = data?.mode === "LOST_DEVICE_MODE";
    actions.append(
      actionButton("📍 Get Location", "Hey Jazz, where is my phone?"),
      actionButton("🔔 Ring Phone", "Hey Jazz, ring my phone"),
      actionButton("📷 Front Camera", "Hey Jazz, take a front-camera recovery photo"),
      actionButton("📷 Rear Camera", "Hey Jazz, take a rear-camera recovery photo"),
      actionButton("↻ Refresh Status", "Hey Jazz, recovery status"),
      lostModeOn
        ? actionButton("⏹ Disable Lost Mode", "Hey Jazz, disable lost device mode")
        : actionButton("🛡 Enable Lost Mode", "Hey Jazz, enable lost device mode")
    );
  }

  async function loadPanelStatus(panel) {
    const statusBox = panel.querySelector(".jazz-recovery-status");
    if (!statusBox) return;
    statusBox.textContent = "Checking secure recovery relay…";
    try {
      const response = await recoveryFetch("/api/recovery/status");
      const data = response.data || {};
      const status = data.status || {};
      statusBox.textContent = "";
      const grid = document.createElement("div");
      grid.className = "jazz-recovery-status-grid";
      grid.append(
        metric("Device", data.deviceName || "Mama Android"),
        metric("Status", data.online ? "ONLINE" : "OFFLINE", data.online ? "jazz-recovery-online" : "jazz-recovery-offline"),
        metric("Recovery", data.mode || "NORMAL_MODE"),
        metric("Battery", typeof status.battery === "number" && status.battery >= 0 ? `${status.battery}%${status.charging ? " ⚡" : ""}` : "Unknown"),
        metric("Network", status.network || "Unknown"),
        metric("Last Seen", safeDate(data.lastSeen))
      );
      if (status.accessibilityHealth) {
        grid.append(metric("Accessibility", status.accessibilityHealth === "READY" ? "READY" : status.accessibilityHealth));
      }
      statusBox.appendChild(grid);
      renderActions(panel, data);
    } catch (error) {
      statusBox.textContent = error instanceof Error ? error.message : "Recovery service unavailable";
      renderActions(panel, null);
    }
  }

  function openPanel() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "jazz-recovery-overlay";
    overlay.innerHTML = `
      <section class="jazz-recovery-panel" role="dialog" aria-modal="true" aria-label="Device Recovery">
        <div class="jazz-recovery-head">
          <div><h2>📱 DEVICE RECOVERY</h2><p>Secure owner-authorized recovery channel</p></div>
          <button class="jazz-recovery-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="jazz-recovery-status">Checking secure recovery relay…</div>
        <div class="jazz-recovery-actions"></div>
        <div class="jazz-recovery-note">Recovery uses the existing secure relay and Android Companion outbound connection over any validated internet connection, including mobile data. Android may require manual permission or Accessibility re-enabling if the OS/OEM disables it.</div>
      </section>`;
    overlay.addEventListener("click", event => { if (event.target === overlay) closePanel(); });
    overlay.querySelector(".jazz-recovery-close")?.addEventListener("click", closePanel);
    document.body.appendChild(overlay);
    const panel = overlay.querySelector(".jazz-recovery-panel");
    renderActions(panel, null);
    loadPanelStatus(panel);
  }

  function closePanel() {
    overlay?.remove();
    overlay = null;
  }

  function installQuickAction() {
    const labels = document.querySelectorAll(".quick-actions-grid button.quick-action span");
    for (const label of labels) {
      const button = label.closest("button.quick-action");
      if (!(button instanceof HTMLButtonElement)) continue;
      const text = String(label.textContent || "").trim();
      if (text !== "Open Calculator" && text !== "📱 DEVICE RECOVERY") continue;
      label.textContent = "📱 DEVICE RECOVERY";
      if (button.dataset.jazzRecoveryBound === "1") continue;
      button.dataset.jazzRecoveryBound = "1";
      button.title = "Open Jazz Device Recovery";
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openPanel();
      }, true);
    }
  }

  function locationCard(data) {
    const card = document.createElement("div");
    card.className = "jazz-recovery-card";
    const map = document.createElement("div");
    map.className = "jazz-recovery-map-preview";

    const latitude = Number(data.latitude);
    const longitude = Number(data.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      const frame = document.createElement("iframe");
      frame.title = "Phone location map";
      frame.loading = "lazy";
      frame.referrerPolicy = "no-referrer-when-downgrade";
      frame.src = `https://maps.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}&z=16&output=embed`;
      Object.assign(frame.style, {
        position: "relative",
        zIndex: "4",
        width: "100%",
        height: "100%",
        border: "0",
        display: "block"
      });
      map.appendChild(frame);
    }

    const body = document.createElement("div"); body.className = "jazz-recovery-card-body";
    const title = document.createElement("div"); title.className = "jazz-recovery-card-title";
    const titleText = document.createElement("span"); titleText.textContent = data.status === "LIVE_LOCATION" ? "Live phone location" : "Last known phone location";
    const pill = document.createElement("span"); pill.className = "jazz-recovery-pill"; pill.textContent = data.status || "LOCATION";
    title.append(titleText, pill);
    const sub = document.createElement("div"); sub.className = "jazz-recovery-card-sub";
    sub.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)} • Accuracy ±${Math.round(Number(data.accuracyMeters || 0))} m • ${safeDate(data.timestamp)}`;
    const link = document.createElement("a");
    link.href = `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`;
    link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Open Location ↗";
    body.append(title, sub, link);
    card.append(map, body);
    return card;
  }

  async function photoCard(meta) {
    const card = document.createElement("div");
    card.className = "jazz-recovery-card";
    const loading = document.createElement("div"); loading.className = "jazz-recovery-card-body"; loading.textContent = "Loading encrypted recovery photo…";
    card.appendChild(loading);
    try {
      const response = await recoveryFetch("/api/recovery/photo");
      const photo = response.data || {};
      if (!photo.ok || !photo.dataUrl) throw new Error("Recovery photo is no longer available.");
      card.textContent = "";
      const image = document.createElement("img");
      image.className = "jazz-recovery-photo";
      image.alt = `${photo.camera || meta.camera || "Front"} recovery photo from Mama Android`;
      image.src = photo.dataUrl;
      const body = document.createElement("div"); body.className = "jazz-recovery-photo-meta";
      const title = document.createElement("strong"); title.textContent = "Recovery Photo";
      const sub = document.createElement("span");
      sub.textContent = `Device: ${photo.deviceName || meta.deviceName || "Mama Android"} • Camera: ${photo.camera || meta.camera || "front"} • Captured: ${safeDate(photo.timestamp || meta.timestamp)}`;
      body.append(title, sub);
      card.append(image, body);
    } catch (error) {
      loading.textContent = error instanceof Error ? error.message : "Could not load recovery photo.";
    }
    return card;
  }

  function enrichChat() {
    const bubbles = document.querySelectorAll(".jazz-bubble > div:first-child");
    for (const bubble of bubbles) {
      if (!(bubble instanceof HTMLElement)) continue;
      if (bubble.dataset.jazzRecoveryRendered) continue;
      const text = bubble.textContent || "";
      const locationMarker = "[[JAZZ_RECOVERY_LOCATION]]";
      const photoMarker = "[[JAZZ_RECOVERY_PHOTO]]";
      if (text.includes(locationMarker)) {
        const [lead, raw] = text.split(locationMarker, 2);
        try {
          const data = JSON.parse(raw);
          bubble.textContent = lead.trim();
          bubble.appendChild(locationCard(data));
          bubble.dataset.jazzRecoveryRendered = "location";
        } catch {}
      } else if (text.includes(photoMarker)) {
        const [lead, raw] = text.split(photoMarker, 2);
        try {
          const meta = JSON.parse(raw);
          bubble.textContent = lead.trim();
          const placeholder = document.createElement("div");
          bubble.appendChild(placeholder);
          bubble.dataset.jazzRecoveryRendered = "photo";
          photoCard(meta).then(card => placeholder.replaceWith(card)).catch(() => undefined);
        } catch {}
      }
    }
  }

  function lightweightRefresh() {
    if (document.hidden) return;
    installQuickAction();
    enrichChat();
  }

  pollTimer = window.setInterval(lightweightRefresh, POLL_MS);
  window.addEventListener("visibilitychange", () => { if (!document.hidden) lightweightRefresh(); });
  window.addEventListener("beforeunload", () => window.clearInterval(pollTimer), { once: true });
  window.addEventListener("DOMContentLoaded", lightweightRefresh, { once: true });
  queueMicrotask(lightweightRefresh);

  window.JazzRecovery = { open: openPanel, close: closePanel, send: sendThroughJazz };
})();
