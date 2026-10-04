"use strict";
const $ = (s) => document.querySelector(s),
  root = $("#app");
const boot = window.Native
  ? JSON.parse(Native.boot())
  : { signedIn: "false", base: "", stt: "local" };
let state = {
  messages: [],
  reminders: [],
  calls: [],
  profile: { name: "Mama", about: "Available", avatar: "" },
  jazzProfile: {
    name: "Jazz AI",
    about: "Your personal AI assistant",
    avatar: "",
  },
};
let page = "home",
  replyTo = null,
  currentCall = null,
  muted = false,
  speaker = true,
  typing = false,
  connection = boot.connection || "Disconnected",
  filter = "upcoming",
  messageBusy = false,
  photoTarget = "user",
  callStarted = Date.now();
const pending = new Map();
function api(route, body = null) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    pending.set(id, { resolve, reject });
    if (!window.Native) {
      reject(new Error("Open this app on Android to connect to Jazz."));
      return;
    }
    Native.request(id, route, JSON.stringify(body));
  });
}
window.nativeResult = (id, data, error) => {
  const task = pending.get(id);
  if (!task) return;
  pending.delete(id);
  error ? task.reject(new Error(error)) : task.resolve(data);
};
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name) =>
  `<svg class="icon" aria-hidden="true"><use href="#${name}"/></svg>`;
const avatar = (p = state.jazzProfile) =>
  `<div class="avatar">${p.avatar ? `<img src="${esc(p.avatar)}" alt="${esc(p.name)}">` : esc(p === state.profile ? p.name?.[0] || "M" : "J")}</div>`;
const date = (t) =>
  new Date(t).toLocaleString("en-IN", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const time = (t) =>
  new Date(t).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").style.display = "none"), 3500);
}
const act = (action, label, klass = "") =>
  `<button type="button" class="${klass}" data-action="${action}">${label}</button>`;
function headerBar(title, back = true, extras = "") {
  return `<header class="topbar">${back ? act("home", icon("back"), "iconbtn") : ""}<div class="title"><h2>${title}</h2></div>${extras}</header>`;
}
function nav() {
  return `<nav class="nav">${[
    ["home", "home", "Home"],
    ["chats", "chat", "Chats"],
    ["calls", "call", "Calls"],
    ["reminders", "bell", "Reminders"],
  ]
    .map(([p, i, label]) =>
      act(
        p,
        `<span class="pill">${icon(i)}</span>${label}`,
        page === p ? "selected" : "",
      ),
    )
    .join("")}</nav>`;
}
function empty(i, title, text) {
  return `<div class="empty">${icon(i)}<h3>${title}</h3><p>${text}</p></div>`;
}
function show(p) {
  page = p;
  render();
}
function render() {
  if (page === "login") {
    renderLogin();
    return;
  }
  if (page === "call") {
    renderCall();
    return;
  }
  const savedDraft = $("#message")?.value || "";
  switch (page) {
    case "home":
      root.innerHTML =
        headerBar(
          'Jazz<span style="color:#61ead5">WhatsApp</span>',
          false,
          act("settings", icon("settings"), "iconbtn"),
        ) +
        `<main class="screen"><div class="eyebrow">YOUR EVERYDAY COMPANION</div><section class="hero"><h1>Hey ${esc(state.profile.name)}.<br>Let’s talk.</h1><p>A familiar chat. Your own Jazz.<br>Always a conversation away.</p>${act("chat", icon("chat") + "Chat with Jazz", "cta")}</section><div class="sectiontitle">Make room for what matters <span class="badge">${state.reminders.filter((r) => r.status === "scheduled").length} reminders</span></div><div class="grid">${[
          ["callJazz", "call", "Call Jazz", "Speak naturally"],
          ["reminders", "bell", "Reminders", "A little nudge, on time"],
          ["devices", "shield", "Devices", "Your existing Jazz tools"],
          ["recovery", "shield", "Recovery", "Find your lost phone"],
        ]
          .map(([a, i, t, d]) =>
            act(
              a,
              `<div class="tileicon">${icon(i)}</div><h3>${t}</h3><p>${d}</p>`,
              "tile",
            ),
          )
          .join(
            "",
          )}</div><div class="sectiontitle">Continue your conversation</div>${chatRow()}<div class="privacy"><span class="statusdot"></span>${esc(connection)} · Your existing Jazz API</div></main>` +
        nav();
      break;
    case "chats":
      root.innerHTML =
        headerBar("Chats", false, act("chat", icon("plus"), "iconbtn")) +
        `<main class="screen">${chatRow()}<p class="privacy">Messages, voice conversations, and reminders from Jazz.</p></main>` +
        nav();
      break;
    case "chat":
      renderChat();
      if ($("#message")) $("#message").value = savedDraft;
      return;
    case "reminders":
      root.innerHTML =
        headerBar(
          "Reminders",
          false,
          act("newReminder", icon("plus"), "iconbtn"),
        ) +
        `<main class="screen"><div class="tabs">${act("upcoming", "Upcoming", filter === "upcoming" ? "selected" : "")}${act("completed", "Completed", filter === "completed" ? "selected" : "")}</div>${reminderCards()}</main>` +
        nav();
      break;
    case "calls":
      root.innerHTML =
        headerBar("Calls", false, act("callJazz", icon("call"), "iconbtn")) +
        `<main class="screen"><div class="hero"><div class="eyebrow">A VOICE THAT FEELS FAMILIAR</div><h2>Jazz is a call away.</h2><p>Ask, think out loud, or just say hello.</p>${act("callJazz", icon("call") + "Call Jazz", "cta")}</div><div class="sectiontitle">Recent calls</div>${
          state.calls.length
            ? state.calls
                .slice()
                .reverse()
                .map(
                  (c) =>
                    `<button class="row" data-action="callJazz">${avatar()}<div class="details"><h3>${esc(state.jazzProfile.name)}</h3><p>${c.direction === "incoming" ? "↙" : "↗"} ${esc(c.status)} · ${date(c.createdAt)}</p></div>${icon("call")}</button>`,
                )
                .join("")
            : empty("call", "No calls yet", "Start a conversation with Jazz.")
        }</main>` +
        nav();
      break;
    case "profile":
    case "jazzProfile":
      renderProfile();
      break;
    case "settings":
      root.innerHTML =
        headerBar("Settings") +
        `<main class="screen"><button class="row" data-action="profile">${avatar(state.profile)}<div class="details"><h3>${esc(state.profile.name)}</h3><p>${esc(state.profile.about)}</p></div>${icon("settings")}</button>${[
          [
            "server",
            "chat",
            "Jazz connection",
            boot.base || "Set your server URL",
          ],
          [
            "speech",
            "mic",
            "Speech recognition",
            boot.stt === "android"
              ? "Android speech service"
              : "Local Whisper speech",
          ],
          [
            "fullScreen",
            "call",
            "Incoming call display",
            "Allow full-screen calls on the lock screen",
          ],
          [
            "battery",
            "bell",
            "Battery settings",
            "Keep Jazz connected in the background",
          ],
          [
            "jazzProfile",
            "chat",
            "Jazz profile",
            "Change Jazz’s name and profile photo",
          ],
          [
            "escalation",
            "bell",
            "Reminder call delay",
            `${localStorage.getItem("escalation") || 120} seconds without a reply`,
          ],
          ["logout", "shield", "Sign out", "This device only"],
        ]
          .map(
            ([a, i, t, d]) =>
              `<button class="row" data-action="${a}">${icon(i)}<div class="details"><h3>${t}</h3><p>${esc(d)}</p></div></button>`,
          )
          .join(
            "",
          )}<p class="privacy">JazzWhatsApp 1.0 · Dark theme<br>Calls use your internet connection, not a cellular provider.</p></main>`;
      break;
  }
}
function chatRow() {
  const last = state.messages.at(-1);
  return `<button class="row" data-action="chat">${avatar()}<div class="details"><h3>${esc(state.jazzProfile.name)}</h3><p>${esc(last?.text || "Your personal AI assistant")}</p></div><small>${last ? time(last.createdAt) : "Say hello"}</small></button>`;
}
function reminderCards() {
  const list = state.reminders.filter((r) =>
    filter === "completed"
      ? ["completed", "cancelled"].includes(r.status)
      : !["completed", "cancelled"].includes(r.status),
  );
  return list.length
    ? list
        .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
        .map(
          (r) =>
            `<article class="remindercard"><h3>${esc(r.title)}</h3><p>${date(r.scheduledAt)} · ${esc(r.status.replaceAll("_", " "))}</p><p>Call after ${r.escalationDelaySeconds || 120}s without acknowledgement</p>${!["completed", "cancelled"].includes(r.status) ? `<div class="actions"><button data-reminder="${r.id}" data-status="completed">✓ Done</button><button data-reminder="${r.id}" data-status="snoozed">Snooze</button><button data-reminder="${r.id}" data-status="cancelled">Cancel</button></div>` : ""}</article>`,
        )
        .join("")
    : empty(
        "bell",
        filter === "upcoming"
          ? "Nothing to remember just yet."
          : "No completed reminders",
        "Tell Jazz a time and a task, or tap +.",
      );
}
function renderChat() {
  root.innerHTML = `<header class="topbar">${act("chats", icon("back"), "iconbtn")}<button data-action="jazzProfile" style="display:flex;align-items:center;gap:10px;flex:1;text-align:left">${avatar()}<div><h3>${esc(state.jazzProfile.name)}</h3><small>${typing ? "typing…" : connection === "Connected" ? "online" : "connecting…"}</small></div></button>${act("callJazz", icon("call"), "iconbtn")}${act("chatMenu", icon("more"), "iconbtn")}</header>${connection !== "Connected" ? `<div class="connectionBanner">${esc(connection)}</div>` : ""}<main class="chatwall" id="messages"><div class="day">Today</div>${state.messages.map(bubble).join("")}${typing ? '<div class="bubble"><div class="muted">Jazz is typing…</div></div>' : ""}</main><div class="composerwrap">${replyTo ? `<div class="replybar"><div><b>Replying to ${replyTo.sender === "jazz" ? esc(state.jazzProfile.name) : "you"}</b><p>${esc(replyTo.text.slice(0, 80))}</p></div>${act("cancelReply", "×")}</div>` : ""}<form id="composer" class="composer"><div class="inputbox">${act("emoji", "☺", "iconbtn")}<textarea id="message" rows="1" placeholder="Message" aria-label="Message"></textarea>${act("attachment", icon("clip"), "iconbtn")}${act("photoMessage", icon("camera"), "iconbtn")}</div><button type="submit" class="sendbtn" aria-label="Send">${icon("send")}</button>${act("dictate", icon("mic"), "iconbtn")}</form></div>`;
  requestAnimationFrame(
    () => ($("#messages").scrollTop = $("#messages").scrollHeight),
  );
}
function bubble(m) {
  const parent = state.messages.find((p) => p.id === m.replyTo);
  return `<article class="bubble ${m.sender === "user" ? "sent" : ""}" data-message="${m.id}" tabindex="0">${parent ? `<div class="quote"><b>${parent.sender === "jazz" ? esc(state.jazzProfile.name) : "You"}</b>${esc(parent.text.slice(0, 130))}</div>` : ""}${m.image ? `<img class="attachment" src="${esc(m.image)}" alt="Shared image">` : ""}<div class="text">${esc(m.text)}</div><span class="meta">${time(m.createdAt)}${m.sender === "user" ? `<span class="ticks ${m.status === "read" ? "read" : ""}">✓✓</span>` : ""}</span>${m.type === "reminder" ? `<div class="reminderActions"><button data-reminder="${m.reminderId}" data-status="completed">✓ Done</button><button data-reminder="${m.reminderId}" data-status="snoozed">◷ Snooze</button></div>` : ""}${m.reaction ? `<div class="reaction">${esc(m.reaction)}</div>` : ""}</article>`;
}
function renderLogin() {
  root.innerHTML = `<main class="login"><div class="logo">${icon("chat")}</div><div class="eyebrow">SAME JAZZ. CLOSER TO YOU.</div><h1>Welcome, Mama.</h1><p>Your chat, reminders, and voice calls in one place.</p><form class="form" id="login"><div><label for="base">Jazz API server</label><input id="base" name="base" value="${esc(boot.base)}" placeholder="http://192.168.1.10:8797" type="url" required></div><div><label for="username">Username</label><input id="username" name="username" placeholder="guna" autocomplete="username" pattern="[A-Za-z0-9_]{3,40}" required></div><div><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" minlength="8" required></div><button class="cta" type="submit">Connect to Jazz ${icon("send")}</button><p id="loginError" class="muted"></p></form><p class="fineprint">Use your existing app account. First-time account creation must be enabled on your Jazz server. Your phone and server need to be able to reach each other.</p></main>`;
}
function renderProfile() {
  const jazz = page === "jazzProfile",
    p = jazz ? state.jazzProfile : state.profile;
  root.innerHTML =
    headerBar(jazz ? "Jazz profile" : "Your profile") +
    `<main class="screen"><div class="profilehead"><button data-action="changePhoto">${avatar(p)}</button><h1>${esc(p.name)}</h1><p>${esc(p.about)}</p>${jazz ? act("callJazz", icon("call") + "Voice call", "cta") : ""}</div><form class="form" id="profileForm"><div><label>Display name</label><input name="name" value="${esc(p.name)}" maxlength="80" required></div><div><label>About</label><input name="about" value="${esc(p.about)}" maxlength="200"></div><button type="submit" class="cta">Save profile</button></form><p class="privacy">Tap the photo to choose a new profile picture.</p></main>`;
}
function renderCall() {
  if (!currentCall) {
    show("home");
    return;
  }
  const ringing = currentCall.status === "ringing";
  root.innerHTML = `<main class="callScreen"><div class="callTop">${act("home", icon("back"), "iconbtn")}<span>JazzWhatsApp voice call</span>${icon("shield")}</div><div class="callTitle"><h1>${esc(state.jazzProfile.name)}</h1><p id="callTime">${ringing ? "Incoming voice call" : "Connecting…"}</p></div><div class="orbStage"><div class="orb" id="orb">${state.jazzProfile.avatar ? `<img class="orbAvatar" src="${esc(state.jazzProfile.avatar)}" alt="Jazz">` : `<svg viewBox="0 0 130 80"><defs><linearGradient id="wave" x1="0" x2="1"><stop stop-color="#356cff"/><stop offset="1" stop-color="#53fff1"/></linearGradient></defs><path d="M5 47 Q30 5 65 40 T125 27" fill="none" stroke="url(#wave)" stroke-width="3"/><path d="M5 50 Q30 15 65 43 T125 31" fill="none" stroke="#44d6f5" stroke-width="1" opacity=".6"/></svg>`}</div></div><div class="voiceStatus"><div class="bars">${"<i></i>".repeat(5)}</div><span id="voiceStatus">${ringing ? "Jazz is calling you" : "Connecting to Jazz"}</span></div><p class="transcript" id="transcript">${ringing ? esc(currentCall.title || "Your reminder is waiting.") : "A moment to connect. Then, just talk."}</p><div class="callControls">${ringing ? `<div class="callControl">${act("declineCall", icon("call"), "danger")}Decline</div><div class="callControl">${act("answerCall", icon("call"), "answer")}Answer</div>` : `<div class="callControl">${act("mute", icon("mic"), muted ? "active" : "")}Mute</div><div class="callControl">${act("speaker", icon("speaker"), speaker ? "active" : "")}Speaker</div><div class="callControl">${act("interrupt", icon("chat"))}Interrupt</div><div class="callControl">${act("endCall", icon("call"), "danger")}End call</div>`}</div><p class="callhint">${ringing ? "Answer to hear your reminder and continue talking." : "Private server connection · Microphone on only during your call"}</p></main>`;
}
function sheet(html) {
  $("#modal").innerHTML =
    `<div class="sheet">${act("closeModal", "×", "close iconbtn")}${html}</div>`;
  $("#modal").classList.remove("hidden");
}
function closeSheet() {
  $("#modal").classList.add("hidden");
  $("#modal").innerHTML = "";
}
async function sync() {
  try {
    Object.assign(state, await api("/sync"));
    render();
    Native.connect();
  } catch (e) {
    toast(e.message);
    if (e.message === "Sign in again") show("login");
  }
}
async function send(text) {
  if (messageBusy || !text.trim()) return;
  const quote = replyTo;
  replyTo = null;
  messageBusy = true;
  if ($("#message")) $("#message").value = "";
  try {
    const data = await api("/message", {
      text,
      replyTo: quote?.id,
      clientId: crypto.randomUUID(),
      escalationDelaySeconds: Number(localStorage.getItem("escalation") || 120),
    });
    if (data.message && !state.messages.some((m) => m.id === data.message.id))
      state.messages.push(data.message);
    if (
      data.assistant &&
      !state.messages.some((m) => m.id === data.assistant.id)
    )
      state.messages.push(data.assistant);
    render();
  } catch (e) {
    toast(e.message);
    if ($("#message")) $("#message").value = text;
  } finally {
    messageBusy = false;
  }
}
let afterMicrophone = null;
function ensureMicrophone(action) {
  if (Native.microphone()) {
    return true;
  }
  afterMicrophone = action;
  Native.requestMicrophone();
  toast("Microphone access is needed for a Jazz call.");
  return false;
}
async function callJazz() {
  if (!ensureMicrophone(callJazz)) return;
  try {
    const { call } = await api("/call", {});
    currentCall = call;
    callStarted = Date.now();
    Native.callScreen(JSON.stringify(call));
  } catch (e) {
    toast(e.message);
  }
}
async function answer() {
  if (!ensureMicrophone(answer)) return;
  try {
    const { call } = await api("/call-action", {
      id: currentCall.id,
      action: "answer",
    });
    currentCall = call;
    callStarted = Date.now();
    renderCall();
    Native.voice(JSON.stringify(call));
  } catch (e) {
    toast(e.message);
  }
}
async function end(action) {
  try {
    await api("/call-action", { id: currentCall.id, action });
  } catch (e) {
    toast(e.message);
  }
  Native.endVoice();
  currentCall = null;
  show("calls");
  sync();
}
async function reminderAction(id, action, minutes) {
  try {
    const { reminder } = await api("/reminder-action", { id, action, minutes });
    const index = state.reminders.findIndex((r) => r.id === id);
    if (index >= 0) state.reminders[index] = reminder;
    closeSheet();
    render();
    toast(
      action === "completed"
        ? "Reminder completed"
        : action === "snoozed"
          ? `Snoozed for ${minutes} minutes`
          : "Reminder updated",
    );
  } catch (e) {
    toast(e.message);
  }
}
let streamingText = "",
  streamingTimer;
let longTimer;
root.addEventListener("pointerdown", (e) => {
  const m = e.target.closest("[data-message]");
  if (m && !e.target.closest("button"))
    longTimer = setTimeout(() => messageMenu(m.dataset.message), 500);
});
root.addEventListener("pointerup", () => clearTimeout(longTimer));
root.addEventListener("pointermove", () => clearTimeout(longTimer));
root.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const m = e.target.closest("[data-message]");
  if (m) messageMenu(m.dataset.message);
});
function messageMenu(id) {
  const m = state.messages.find((m) => m.id === id);
  if (!m) return;
  sheet(
    `<div class="emojis">${["👍", "❤️", "😂", "😮", "🙏"].map((emoji) => `<button data-react="${id}" data-emoji="${emoji}">${emoji}</button>`).join("")}</div>${[
      ["reply", "Reply"],
      ["copy", "Copy"],
      ["share", "Share"],
      ["delete", "Delete"],
    ]
      .map(
        ([a, t]) =>
          `<button class="row" data-message-action="${a}" data-id="${id}">${t}</button>`,
      )
      .join("")}`,
  );
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.type !== "submit") e.preventDefault();
  try {
    if (b.dataset.react) {
      await api("/message-action", {
        id: b.dataset.react,
        action: "react",
        emoji: b.dataset.emoji,
      });
      closeSheet();
      return;
    }
    if (b.dataset.messageAction) {
      const m = state.messages.find((m) => m.id === b.dataset.id);
      switch (b.dataset.messageAction) {
        case "reply":
          replyTo = m;
          closeSheet();
          show("chat");
          $("#message").focus();
          break;
        case "copy":
          Native.copy(m.text);
          closeSheet();
          toast("Copied");
          break;
        case "share":
          Native.share(m.text);
          closeSheet();
          break;
        case "delete":
          await api("/message-action", { id: m.id, action: "delete" });
          closeSheet();
      }
      return;
    }
    if (b.dataset.reminder) {
      if (b.dataset.status === "snoozed")
        sheet(
          `<h2>Snooze reminder</h2><form id="snooze" data-id="${b.dataset.reminder}" class="form"><input name="minutes" type="number" min="1" max="10080" value="10" required><button type="submit" class="cta">Snooze</button></form>`,
        );
      else reminderAction(b.dataset.reminder, b.dataset.status);
      return;
    }
    const a = b.dataset.action;
    if (!a) return;
    if (
      [
        "home",
        "chats",
        "chat",
        "calls",
        "reminders",
        "settings",
        "profile",
        "jazzProfile",
      ].includes(a)
    ) {
      show(a);
      return;
    }
    switch (a) {
      case "closeModal":
        closeSheet();
        break;
      case "callJazz":
        callJazz();
        break;
      case "answerCall":
        answer();
        break;
      case "endCall":
        end("end");
        break;
      case "declineCall":
        end("decline");
        break;
      case "mute":
        muted = !muted;
        Native.mute(muted);
        renderCall();
        break;
      case "speaker":
        speaker = !speaker;
        Native.speaker(speaker);
        renderCall();
        break;
      case "interrupt":
        Native.interrupt();
        break;
      case "dictate":
        Native.dictate();
        break;
      case "cancelReply":
        replyTo = null;
        render();
        break;
      case "upcoming":
      case "completed":
        filter = a;
        render();
        break;
      case "recovery":
        Native.recovery();
        break;
      case "fullScreen":
        Native.fullScreenSettings();
        break;
      case "battery":
        Native.batterySettings();
        break;
      case "changePhoto":
        photoTarget = page === "jazzProfile" ? "jazz" : "user";
        Native.photo(photoTarget);
        break;
      case "devices":
        sheet(
          '<h2>Your existing device workflows</h2><p class="muted">Send a command in the Jazz conversation. Your existing API routes it to Android Companion.</p><div class="row">Open Instagram</div><div class="row">Call Mom</div><div class="row">Device status</div>' +
            act("chat", "Open Jazz chat", "cta"),
        );
        break;
      case "newReminder":
        sheet(
          `<h2>Make a little room for later.</h2><form class="form" id="newReminder"><div><label>Remind me to</label><input name="title" placeholder="Buy medicine for Mom" maxlength="500" required></div><div><label>Date and time (your phone’s timezone)</label><input name="scheduledAt" type="datetime-local" required></div><div><label>Call if I don’t reply within</label><select name="escalationDelaySeconds">${[30, 60, 120, 300, 600].map((s) => `<option value="${s}" ${s === Number(localStorage.getItem("escalation") || 120) ? "selected" : ""}>${s < 60 ? s + " seconds" : s / 60 + " minutes"}</option>`).join("")}</select></div><button class="cta" type="submit">Set reminder</button></form>`,
        );
        break;
      case "emoji":
        sheet(
          `<h2>A little expression</h2><div class="emojis">${["😊", "👍", "❤️", "🙏", "🎉"].map((x) => `<button data-insert="${x}">${x}</button>`).join("")}</div>`,
        );
        break;
      case "attachment":
        sheet(
          "<h2>Share with Jazz</h2>" +
            act("photoMessage", icon("camera") + " Choose an image", "row") +
            act("shareReminder", icon("bell") + " Share reminder list", "row"),
        );
        break;
      case "photoMessage":
        photoTarget = "message";
        closeSheet();
        Native.photo("message");
        break;
      case "shareReminder":
        Native.share(
          state.reminders
            .map((r) => r.title + " — " + date(r.scheduledAt))
            .join("\n") || "No reminders",
        );
        closeSheet();
        break;
      case "chatMenu":
        sheet(
          "<h2>Jazz conversation</h2>" +
            act("jazzProfile", "Jazz profile", "row") +
            act("newReminder", "Set reminder", "row") +
            act("callJazz", "Voice call", "row"),
        );
        break;
      case "server":
        sheet(
          `<h2>Jazz connection</h2><form id="serverForm" class="form"><input name="base" type="url" value="${esc(boot.base)}" required><button type="submit" class="cta">Save & sign in</button></form>`,
        );
        break;
      case "speech":
        sheet(
          `<h2>Speech recognition</h2><p class="muted">Local Whisper uses your Jazz speech service. Android speech uses the installed recognizer and prefers offline recognition.</p><form id="speech" class="form"><select name="stt"><option value="local" ${boot.stt === "local" ? "selected" : ""}>Local Whisper</option><option value="android" ${boot.stt === "android" ? "selected" : ""}>Android speech</option></select><button type="submit" class="cta">Save</button></form>`,
        );
        break;
      case "escalation":
        sheet(
          `<h2>No-reply call delay</h2><form id="escalation" class="form"><select name="delay">${[30, 60, 120, 300, 600].map((s) => `<option value="${s}">${s} seconds</option>`).join("")}</select><button type="submit" class="cta">Save</button></form>`,
        );
        break;
      case "logout":
        await api("/logout", {});
        show("login");
        break;
    }
    if (
      !["newReminder", "chatMenu"].includes(a) &&
      ["home", "chat", "jazzProfile", "callJazz"].includes(a)
    )
      closeSheet();
  } catch (err) {
    toast(err.message);
  }
  if (b.dataset.insert) {
    const input = $("#message");
    input.value += b.dataset.insert;
    closeSheet();
    input.focus();
  }
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target,
    values = Object.fromEntries(new FormData(f));
  try {
    switch (f.id) {
      case "login":
        f.querySelector("button").disabled = true;
        boot.base = values.base.replace(/\/+$/, "");
        Native.configure(boot.base, boot.stt || "local");
        Object.assign(
          state,
          await api("/auth", {
            username: values.username,
            password: values.password,
          }),
        );
        show("home");
        Native.connect();
        break;
      case "composer":
        send($("#message").value);
        break;
      case "profileForm":
        await api("/profile", { ...values, jazz: page === "jazzProfile" });
        toast("Profile updated");
        sync();
        break;
      case "newReminder":
        const { reminder } = await api("/reminders", {
          title: values.title,
          scheduledAt: new Date(values.scheduledAt).toISOString(),
          escalationDelaySeconds: Number(values.escalationDelaySeconds),
        });
        state.reminders.push(reminder);
        closeSheet();
        show("reminders");
        toast("Reminder scheduled");
        break;
      case "snooze":
        reminderAction(f.dataset.id, "snoozed", Number(values.minutes));
        break;
      case "serverForm":
        boot.base = values.base;
        Native.configure(values.base, boot.stt);
        closeSheet();
        show("login");
        break;
      case "speech":
        boot.stt = values.stt;
        Native.configure(boot.base, values.stt);
        closeSheet();
        render();
        break;
      case "escalation":
        localStorage.setItem("escalation", values.delay);
        closeSheet();
        render();
        break;
    }
  } catch (err) {
    if (f.id === "login") $("#loginError").textContent = err.message;
    else toast(err.message);
  } finally {
    if (f.id === "login" && f.querySelector("button"))
      f.querySelector("button").disabled = false;
  }
});
function mergeMessage(m) {
  const i = state.messages.findIndex((item) => item.id === m.id);
  if (i < 0) state.messages.push(m);
  else state.messages[i] = m;
}
window.onNativeEvent = (raw) => {
  const event = typeof raw === "string" ? JSON.parse(raw) : raw;
  switch (event.type) {
    case "microphonePermission":
      if (event.granted === "true" && afterMicrophone) {
        const action = afterMicrophone;
        afterMicrophone = null;
        action();
      } else toast("Allow microphone access to use voice calls.");
      break;
    case "connection":
      connection = event.status;
      if (page !== "call" && page !== "login") render();
      break;
    case "sync":
      Object.assign(state, event);
      if (page !== "call" && page !== "login") render();
      break;
    case "message.delta":
      streamingText += event.text;
      if (page === "chat" && !streamingTimer)
        streamingTimer = setTimeout(() => {
          streamingTimer = null;
          let bubble = $("#streaming");
          if (!bubble) {
            bubble = document.createElement("div");
            bubble.id = "streaming";
            bubble.className = "bubble";
            $("#messages").append(bubble);
          }
          bubble.textContent = streamingText;
          $("#messages").scrollTop = $("#messages").scrollHeight;
        }, 85);
      break;
    case "message.new":
    case "message.updated":
      if (event.message.sender === "jazz") {
        streamingText = "";
        clearTimeout(streamingTimer);
        streamingTimer = null;
        $("#streaming")?.remove();
      }
      mergeMessage(event.message);
      if (page === "chat") render();
      break;
    case "jazz.typing":
      typing = event.active;
      if (page === "chat") render();
      break;
    case "reminder.updated":
      const i = state.reminders.findIndex((r) => r.id === event.reminder.id);
      if (i < 0) state.reminders.push(event.reminder);
      else state.reminders[i] = event.reminder;
      if (page === "reminders") render();
      break;
    case "profile.updated":
      Object.assign(state, event);
      if (page !== "call") render();
      break;
    case "openCall":
      currentCall =
        typeof event.call === "string" ? JSON.parse(event.call) : event.call;
      show("call");
      if (event.answer === "true") answer();
      break;
    case "call.incoming":
      if (page !== "call" && page !== "login")
        toast("Jazz is calling. Open the call notification to answer.");
      break;
    case "call.ended":
    case "call.updated":
      if (
        currentCall?.id === event.call?.id &&
        ["cancelled", "missed", "ended", "declined"].includes(event.call.status)
      ) {
        Native.endVoice();
        currentCall = null;
        show("calls");
      }
      break;
    case "call.localEnded":
      if (currentCall?.id === event.id) {
        Native.endVoice();
        currentCall = null;
        show("calls");
      }
      break;
    case "voice":
      if ($("#voiceStatus")) {
        $("#voiceStatus").textContent = event.status;
        if (event.text) $("#transcript").textContent = event.text;
        $("#orb")?.style.setProperty("--level", event.level || 0);
        document
          .querySelectorAll(".bars i")
          .forEach(
            (bar, n) =>
              (bar.style.height =
                5 +
                (event.level || 0) * 20 * (1 - Math.abs(2 - n) * 0.15) +
                "px"),
          );
      }
      break;
    case "error":
      toast(event.error);
      break;
    case "dictation":
      if (event.text) {
        show("chat");
        $("#message").value = event.text;
        $("#message").focus();
      } else toast("Listening…");
      break;
    case "photo":
      if (event.target === "message") {
        api("/image", { image: event.avatar, text: "Shared image" })
          .then((data) => {
            mergeMessage(data.message);
            show("chat");
          })
          .catch((e) => toast(e.message));
      } else {
        const p = event.target === "jazz" ? state.jazzProfile : state.profile;
        api("/profile", {
          ...p,
          avatar: event.avatar,
          jazz: event.target === "jazz",
        })
          .then(() => sync())
          .catch((e) => toast(e.message));
      }
      break;
  }
};
window.goBack = () => {
  if (!$("#modal").classList.contains("hidden")) closeSheet();
  else show("home");
};
setInterval(() => {
  if (page === "call" && currentCall?.status === "active" && $("#callTime")) {
    const elapsed = Math.floor((Date.now() - callStarted) / 1000);
    $("#callTime").textContent =
      String(Math.floor(elapsed / 60)).padStart(2, "0") +
      ":" +
      String(elapsed % 60).padStart(2, "0");
  }
}, 1000);
if (boot.call) {
  currentCall = boot.call;
  page = "call";
  render();
  if (boot.autoAnswer) answer();
  else if (currentCall.status === "active")
    Native.voice(JSON.stringify(currentCall));
  api("/sync")
    .then((data) => {
      Object.assign(state, data);
      if (page === "call") renderCall();
    })
    .catch((e) => toast(e.message));
} else if (boot.signedIn === "true") {
  render();
  sync();
} else show("login");
