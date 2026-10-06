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
let chatGeneration = 0;
let previewImage = null, cameraStream = null, cameraStarting = false, cameraWanted = false, cameraForeground = true;
currentCall = boot.activeCall || null;
let storageKey = "jazz:" + boot.base;
const loadLocal = (key, fallback) => { try { return JSON.parse(localStorage.getItem(storageKey + key)) || fallback; } catch { return fallback; } };
let outbox = loadLocal(":outbox", []), endedCalls = new Set(loadLocal(":endedCalls", [])), flushing = false;
if (boot.signedIn === "true") Object.assign(state, loadLocal(":cache", {}));
function persistLocal() {
  localStorage.setItem(storageKey + ":outbox", JSON.stringify(outbox));
  localStorage.setItem(storageKey + ":endedCalls", JSON.stringify([...endedCalls]));
  localStorage.setItem(storageKey + ":cache", JSON.stringify(state));
}
function reconcile(data) {
  Object.assign(state, data);
  if (currentCall) { const remote = state.calls.find(c => c.id === currentCall.id); if (remote && !["active", "ringing"].includes(remote.status)) { currentCall = null; Native.endVoice(); } }
  state.calls = state.calls.map(c => endedCalls.has(c.id) ? {...c, status: "ended"} : c);
  if (currentCall && endedCalls.has(currentCall.id)) currentCall = null;
  outbox = outbox.filter(item => !state.messages.some(m => m.status !== "queued" && m.clientId === item.clientId));
  for (const item of outbox) if (!state.messages.some(m => m.clientId === item.clientId)) state.messages.push(item);
  persistLocal();
}
let configureWait = null;
function configureConnection(base, stt) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { configureWait = null; reject(new Error("Server settings did not update. Try again.")); }, 10000);
    configureWait = {resolve:() => { clearTimeout(timer); resolve(); }, reject:error => { clearTimeout(timer); reject(error); }};
    Native.configure(base, stt);
  });
}
function resetConnection(base = boot.base) {
  chatGeneration++; stopCamera();
  for (const task of pending.values()) task.reject(new Error("Connection changed"));
  pending.clear();
  currentCall = null; typing = false; replyTo = null; selectingMessages = false;
  selectedMessages.clear(); outbox = []; endedCalls.clear();
  state.messages = []; state.calls = []; state.reminders = []; delete state.apiVersion;
  state.profile = {name:"Mama",about:"Available",avatar:""};
  state.jazzProfile = {name:"Jazz AI",about:"Your personal AI assistant",avatar:""};
  state.assistantMode = "normal"; state.assistantModel = null;
  persistLocal();
  boot.base = base; storageKey = "jazz:" + base;
  boot.signedIn = "false"; connection = "Disconnected";
  boot.call = null; boot.activeCall = null; boot.voiceRunning = false;
  streamingText = ""; clearTimeout(streamingTimer); streamingTimer = null;
  show("login");
}
function signOutLocal() {
  Native.signOut();
  resetConnection();
}
async function flushOutbox() {
  if (flushing || connection !== "Connected") return;
  flushing = true;
  try {
    for (const id of [...endedCalls]) {
      await api("/call-action", {id, action:"end"});
      endedCalls.delete(id); persistLocal();
    }
    if (window.Native?.enqueue) {
      for (const item of outbox) Native.enqueue(JSON.stringify({text:item.text,replyTo:item.replyTo,imageId:item.imageId,clientId:item.clientId,escalationDelaySeconds:120}));
      return;
    }
    while (outbox.length && connection === "Connected") {
      const item = outbox[0];
      const data = await api("/message", {text:item.text, replyTo:item.replyTo, imageId:item.imageId, clientId:item.clientId, escalationDelaySeconds:120});
      state.messages = state.messages.filter(m => m.id !== item.id);
      if (data.message) mergeMessage(data.message);
      if (data.assistant) mergeMessage(data.assistant);
      outbox.shift(); persistLocal();
      if (page === "chat") render();
    }
  } catch (error) {
    if (/Sign in again/.test(error.message)) toast("Sign in again to deliver queued messages.");
  } finally { flushing = false; }
}
function stopCamera() { cameraWanted = false; cameraStream?.getTracks().forEach(t => t.stop()); cameraStream = null; }
function updateComposer() {
  const button = $("#composerButton"), input = $("#message");
  if (!button || !input) return;
  const hasText = !!input.value.trim();
  button.type = hasText ? "submit" : "button";
  button.dataset.action = hasText ? "" : "dictate";
  button.setAttribute("aria-label", hasText ? "Send" : "Voice message");
  button.innerHTML = icon(hasText ? "send" : "mic");
}
async function startCamera() {
  if (cameraStarting || cameraStream) { if (cameraStream && $("#cameraPreview")) $("#cameraPreview").srcObject = cameraStream; return; }
  if (!cameraForeground || page !== "call" || currentCall?.status !== "active") return;
  cameraWanted = true;
  if (!Native.camera()) { Native.requestCamera(); return; }
  cameraStarting = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: "environment", width: {ideal: 1280}}, audio: false});
    if (!cameraWanted || page !== "call") { stream.getTracks().forEach(t => t.stop()); return; }
    cameraStream = stream;
    if ($("#cameraPreview")) $("#cameraPreview").srcObject = stream;
  } catch (e) { toast("Camera unavailable. Allow camera access or attach a photo instead."); }
  finally { cameraStarting = false; }
}
async function shareFrame() {
  const video = $("#cameraPreview");
  if (!video?.videoWidth || !cameraStream) { toast("Wait for the camera preview first."); return; }
  const canvas = document.createElement("canvas"), scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  const {message} = await api("/image", {image: canvas.toDataURL("image/jpeg", 0.75), text: "Camera frame shared with Jazz", callId: currentCall.id});
  mergeMessage(message);
  currentCall.imageMessageId = message.id;
  toast("Frame shared. Ask Jazz what you want to know about it.");
}
function resumeBanner() {
  const active = currentCall?.status === "active" ? currentCall : state.calls.find(c => c.status === "active" && !endedCalls.has(c.id));
  if (!active) return "";
  if (endedCalls.has(active.id)) return "";
  currentCall = active;
  return act("resumeCall", icon("call") + " Return to call", "returnCall");
}
function showImage(id) {
  previewImage = state.messages.find(m => m.id === id && m.image);
  if (!previewImage) return;
  $("#modal").classList.remove("dropdownOverlay");
  $("#modal").innerHTML = `<div class="imageViewer"><header>${act("closeModal", icon("back"), "iconbtn")}<b>Image</b>${act("downloadImage", icon("download"), "iconbtn")} ${act("askImage", "Ask Jazz")}</header><img src="${esc(previewImage.image)}" alt="Shared image preview"></div>`;
  $("#modal").classList.remove("hidden");
}
document.addEventListener("input", e => { if (e.target.id === "message") updateComposer(); });
const selectedMessages = new Set();
let selectingMessages = false;
function requireCompatibleBackend() {
  if (state.apiVersion !== "1.0.7") throw new Error(`App 1.0.7 needs backend 1.0.7. Server reports ${state.apiVersion || "an older version"}. Apply the update patch and restart Jazz API.`);
}
function removeMessages(ids) {
  chatGeneration++;
  const removed = new Set(ids);
  state.messages = state.messages.filter(m => !removed.has(m.id));
  for (const m of state.messages) if (removed.has(m.replyTo)) delete m.replyTo;
  if (removed.has(replyTo?.id)) replyTo = null;
  selectedMessages.clear();
  selectingMessages = false;
}
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
  if (p !== "call") stopCamera();
  closeSheet();
  page = p;
  render();
}
function render() {
  if (window.Native?.chatVisible) Native.chatVisible(page === "chat");
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
          'Jazz <span style="color:#61ead5">Ai</span>',
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
      updateComposer();
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
            `120 seconds without a reply`,
          ],
          ["voicePlayback", "speaker", "Call voice playback", "Android voice or server Piper"],
          ["notificationAccess", "bell", "Read phone notifications", "Enable access for WhatsApp, Instagram and SMS summaries"],
          ["logout", "shield", "Sign out", "This device only"],
        ]
          .map(
            ([a, i, t, d]) =>
              `<button class="row" data-action="${a}">${icon(i)}<div class="details"><h3>${t}</h3><p>${esc(d)}</p></div></button>`,
          )
          .join(
            "",
          )}<p class="privacy">Jazz Ai 1.0.7 · Dark theme<br>Calls use your internet connection, not a cellular provider.</p></main>`;
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
  root.innerHTML = `<header class="topbar">${act("chats", icon("back"), "iconbtn")}<button data-action="jazzProfile" style="display:flex;align-items:center;gap:10px;flex:1;text-align:left">${avatar()}<div><h3>${esc(state.jazzProfile.name)}</h3><small>${typing ? "typing…" : connection === "Connected" ? "online" : "connecting…"}</small></div></button>${act("videoJazz", icon("video"), "iconbtn")}${act("callJazz", icon("call"), "iconbtn")}${act("chatMenu", icon("more"), "iconbtn")}</header>${resumeBanner()}${connection !== "Connected" ? `<div class="connectionBanner">${esc(connection)}</div>` : ""}${state.apiVersion !== "1.0.7" ? `<div class="connectionBanner">App 1.0.7 · server ${esc(state.apiVersion || "older version")}. Apply the backend update and restart Jazz.</div>` : ""}${selectingMessages ? `<div class="selectionbar">${act("cancelSelection", "Cancel")}<b>${selectedMessages.size} selected</b>${act("selectAllMessages", "Select all")}${act("deleteSelected", "Delete selected")}</div>` : ""}<main class="chatwall" id="messages"><div class="day">Today</div>${state.messages.filter(m => !m.deleted).map(bubble).join("")}${typing ? '<div class="bubble"><div class="muted">Jazz is typing…</div></div>' : ""}</main><div class="composerwrap">${replyTo ? `<div class="replybar"><div><b>Replying to ${replyTo.sender === "jazz" ? esc(state.jazzProfile.name) : "you"}</b><p>${esc(replyTo.text.slice(0, 80))}</p></div>${act("cancelReply", "×")}</div>` : ""}<form id="composer" class="composer"><div class="inputbox">${act("emoji", "☺", "iconbtn")}<textarea id="message" rows="1" placeholder="Message" aria-label="Message"></textarea>${act("attachment", icon("clip"), "iconbtn")}${act("photoMessage", icon("camera"), "iconbtn")}</div><button type="button" id="composerButton" data-action="dictate" class="sendbtn" aria-label="Voice message">${icon("mic")}</button></form></div>`;
  requestAnimationFrame(
    () => ($("#messages").scrollTop = $("#messages").scrollHeight),
  );
}
function bubble(m) {
  const parent = state.messages.find((p) => p.id === m.replyTo);
  const reminderClosed = state.reminders.some(r => r.id === m.reminderId && ["completed", "cancelled"].includes(r.status));
  return `<article class="bubble ${m.sender === "user" ? "sent" : ""} ${m.image ? "imageBubble" : ""} ${selectedMessages.has(m.id) ? "selectedMessage" : ""}" data-message="${m.id}" tabindex="0">${selectingMessages ? `<span class="selectionmark">${selectedMessages.has(m.id) ? "☑" : "☐"}</span>` : ""}${parent ? `<div class="quote"><b>${parent.sender === "jazz" ? esc(state.jazzProfile.name) : "You"}</b>${esc(parent.text.slice(0, 130))}</div>` : ""}${m.image ? `<button class="imageAttachment" data-image="${m.id}" aria-label="Preview image"><img class="attachment" src="${esc(m.image)}" alt="Shared image"></button>` : ""}<div class="text">${m.image && m.text === "Shared image" ? "" : esc(m.text)}</div><span class="meta">${time(m.createdAt)}${m.sender === "user" ? `<span class="ticks ${m.status === "read" ? "read" : ""}">${m.status === "queued" ? "✓" : "✓✓"}</span>` : ""}</span>${m.type === "reminder" && reminderClosed ? `<div class="reminderActions">✅ Reminder closed</div>` : m.type === "reminder" ? `<div class="reminderActions"><button data-reminder="${m.reminderId}" data-status="completed">✓ Done</button><button data-reminder="${m.reminderId}" data-status="snoozed">◷ Snooze</button></div>` : ""}${m.reaction ? `<div class="reaction">${esc(m.reaction)}</div>` : ""}</article>`;
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
  root.innerHTML = `<main class="callScreen"><div class="callTop">${act("home", icon("back"), "iconbtn")}<span>Jazz Ai ${currentCall.cameraMode ? "camera-assisted call" : "voice call"}</span>${icon("shield")}</div><div class="callTitle"><h1>${esc(state.jazzProfile.name)}</h1><p id="callTime">${ringing ? "Incoming voice call" : "Connecting…"}</p></div>${currentCall.cameraMode && !ringing ? `<div class="cameraStage"><video id="cameraPreview" autoplay muted playsinline></video>${act("shareFrame", "Show frame to Jazz", "cta")}<small>Share a frame, then ask Jazz about it. Camera pauses when you leave this screen.</small></div>` : ""}<div class="orbStage"><div class="orb" id="orb">${state.jazzProfile.avatar ? `<img class="orbAvatar" src="${esc(state.jazzProfile.avatar)}" alt="Jazz">` : `<svg viewBox="0 0 130 80"><defs><linearGradient id="wave" x1="0" x2="1"><stop stop-color="#356cff"/><stop offset="1" stop-color="#53fff1"/></linearGradient></defs><path d="M5 47 Q30 5 65 40 T125 27" fill="none" stroke="url(#wave)" stroke-width="3"/><path d="M5 50 Q30 15 65 43 T125 31" fill="none" stroke="#44d6f5" stroke-width="1" opacity=".6"/></svg>`}</div></div><div class="voiceStatus"><div class="bars">${"<i></i>".repeat(5)}</div><span id="voiceStatus">${ringing ? "Jazz is calling you" : "Connecting to Jazz"}</span></div><p class="transcript" id="transcript">${ringing ? esc(currentCall.title || "Your reminder is waiting.") : "A moment to connect. Then, just talk."}</p><div class="callControls">${ringing ? `<div class="callControl">${act("declineCall", icon("call"), "danger")}Decline</div><div class="callControl">${act("answerCall", icon("call"), "answer")}Answer</div>` : `<div class="callControl">${act("mute", icon("mic"), muted ? "active" : "")}Mute</div><div class="callControl">${act("speaker", icon("speaker"), speaker ? "active" : "")}Speaker</div><div class="callControl">${act("interrupt", icon("chat"))}Interrupt</div><div class="callControl">${act("endCall", icon("call"), "danger")}End call</div>`}</div><p class="callhint">${ringing ? "Answer to hear your reminder and continue talking." : "Private server connection · Microphone on only during your call"}</p></main>`;
  if (currentCall?.cameraMode && currentCall.status === "active") startCamera();
}
function sheet(html) {
  $("#modal").classList.remove("dropdownOverlay");
  $("#modal").innerHTML =
    `<div class="sheet">${act("closeModal", "×", "close iconbtn")}${html}</div>`;
  $("#modal").classList.remove("hidden");
}
function chatMenu() {
  $("#modal").innerHTML = `<div class="chatDropdown" role="menu" aria-label="Jazz conversation settings">${act("jazzProfile", "Jazz profile", "row")}${act("newReminder", "Set reminder", "row")}${act("callJazz", "Voice call", "row")}${act("clearChat", "Clear chat", "row")}${act("selectMessages", "Select messages", "row")}${act("settings", "Settings", "row")}</div>`;
  $("#modal").classList.add("dropdownOverlay");
  $("#modal").classList.remove("hidden");
}
$("#modal").addEventListener("click", e => {if (e.target === $("#modal")) closeSheet();});
function closeSheet() {
  $("#modal").classList.remove("dropdownOverlay");
  $("#modal").classList.add("hidden");
  $("#modal").innerHTML = "";
}
async function sync() {
  try {
    const generation = chatGeneration;
    const data = await api("/sync");
    if (generation !== chatGeneration) return;
    reconcile(data);
    render();
    Native.connect();
    flushOutbox();
  } catch (e) {
    if (e.message === "Sign in again") toast(e.message);
    if (e.message === "Sign in again") show("login");
  }
}
async function send(text) {
  if (!text.trim()) return;
  const clientId = crypto.randomUUID();
  const item = {id: "local:" + clientId, clientId, sender:"user", text:text.trim(), status:"queued", createdAt:new Date().toISOString(), replyTo:replyTo?.id, imageId:replyTo?.image ? replyTo.id : undefined};
  outbox.push(item); state.messages.push(item); replyTo = null;
  if ($("#message")) $("#message").value = "";
  persistLocal();
  if (window.Native?.enqueue) Native.enqueue(JSON.stringify({text:item.text, replyTo:item.replyTo, imageId:item.imageId, clientId:item.clientId, escalationDelaySeconds:120}));
  render(); await flushOutbox();
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
async function callJazz(cameraMode = false) {
  const existing = currentCall?.status === "active" || currentCall?.status === "ringing" ? currentCall : state.calls.find(c => ["active", "ringing"].includes(c.status));
  if (existing) { currentCall = {...existing, cameraMode: cameraMode || existing.cameraMode}; Native.callScreen(JSON.stringify(currentCall)); return; }
  if (!ensureMicrophone(() => callJazz(cameraMode))) return;
  try {
    const { call } = await api("/call", {});
    currentCall = {...call, cameraMode: !!cameraMode};
    callStarted = Date.now();
    Native.callScreen(JSON.stringify(currentCall));
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
    currentCall = {...call, cameraMode: currentCall?.cameraMode};
    callStarted = Date.now();
    renderCall();
    Native.voice(JSON.stringify(call));
  } catch (e) {
    toast(e.message);
  }
}
async function end(action) {
  const id = currentCall?.id;
  if (!id) return;
  endedCalls.add(id); stopCamera(); Native.endVoice();
  state.calls = state.calls.map(c => c.id === id ? {...c, status:"ended"} : c);
  currentCall = null; persistLocal(); show("chat");
  try { await api("/call-action", {id, action}); endedCalls.delete(id); persistLocal(); } catch { /* retry on reconnect */ }
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
  if (!selectingMessages && m && !e.target.closest("button"))
    longTimer = setTimeout(() => messageMenu(m.dataset.message), 500);
});
root.addEventListener("pointerup", () => clearTimeout(longTimer));
root.addEventListener("pointermove", () => clearTimeout(longTimer));
root.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const m = e.target.closest("[data-message]");
  if (m && !selectingMessages) messageMenu(m.dataset.message);
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
  const article = e.target.closest("[data-message]");
  if (selectingMessages && article) {
    e.preventDefault();
    selectedMessages.has(article.dataset.message) ? selectedMessages.delete(article.dataset.message) : selectedMessages.add(article.dataset.message);
    render();
    return;
  }
  const b = e.target.closest("button");
  if (!b) return;
  if (b.type !== "submit") e.preventDefault();
  try {
    if (b.dataset.image) { showImage(b.dataset.image); return; }
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
          state.messages = state.messages.filter(item => item.id !== m.id);
          for (const item of state.messages) if (item.replyTo === m.id) delete item.replyTo;
          closeSheet();
          render();
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
    if (!a) {
    if (b.dataset.insert) { const input = $("#message"); if (input) { input.value += b.dataset.insert; updateComposer(); } }
    return;
    }
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
      case "resumeCall":
        if (currentCall) Native.callScreen(JSON.stringify(currentCall));
        break;
      case "videoJazz":
        callJazz(true);
        break;
      case "shareFrame":
        await shareFrame();
        break;
      case "downloadImage":
        if (previewImage) Native.downloadImage(previewImage.image);
        break;
      case "askImage":
        replyTo = previewImage;
        show("chat");
        $("#message").focus();
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
      case "voicePlayback":
        sheet(`<h2>Call voice playback</h2><p>Android voice works even when your server has no Piper installed.</p><form id="voicePlayback" class="form"><select name="tts"><option value="android">Android text-to-speech</option><option value="server">Server Piper, with Android fallback</option></select><button class="cta" type="submit">Save</button></form>${act("ttsSettings", "Android voice settings", "row")}`);
        break;
      case "ttsSettings":
        Native.ttsSettings();
        break;
      case "notificationAccess":
        Native.notificationSettings();
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
          `<h2>Make a little room for later.</h2><form class="form" id="newReminder"><div><label>Remind me to</label><input name="title" placeholder="Buy medicine for Mom" maxlength="500" required></div><div><label>Date and time (your phone’s timezone)</label><input name="scheduledAt" type="datetime-local" required></div><div><label>Call if I don’t reply within</label><select name="escalationDelaySeconds">${[120].map((s) => `<option value="${s}" ${s === Number(localStorage.getItem("escalation") || 120) ? "selected" : ""}>${s < 60 ? s + " seconds" : s / 60 + " minutes"}</option>`).join("")}</select></div><button class="cta" type="submit">Set reminder</button></form>`,
        );
        break;
      case "emoji":
        sheet(
          `<h2>A little expression</h2><div class="emojis">${["😀","😃","😄","😁","😆","🥹","😅","😂","🤣","🥲","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😎","🤔","😈","😭","😴","👍","👎","👏","🙌","🙏","❤️","💚","💙","🔥","🎉","💻","📱","💧","💊","🚗","🏠","🍎","☕","🌸","🐶","⚽","🎵","✅","⏰"].map((x) => `<button data-insert="${x}">${x}</button>`).join("")}</div>`,
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
      case "selectMessages":
        selectingMessages = true;
        selectedMessages.clear();
        closeSheet();
        render();
        break;
      case "selectAllMessages":
        for (const m of state.messages) selectedMessages.add(m.id);
        render();
        break;
      case "cancelSelection":
        selectedMessages.clear();
        selectingMessages = false;
        render();
        break;
      case "deleteSelected":
        requireCompatibleBackend();
        if (!selectedMessages.size) {toast("Select messages first"); break;}
        sheet('<h2>Delete selected messages?</h2><p>' + selectedMessages.size + ' messages will be removed.</p>' + act("confirmDeleteSelected", "Delete messages", "row"));
        break;
      case "confirmDeleteSelected":
        requireCompatibleBackend();
        const ids = [...selectedMessages];
        for (let i = 0; i < ids.length; i += 500) await api("/delete-messages", {ids: ids.slice(i, i + 500)});
        removeMessages(ids);
        closeSheet();
        render();
        break;
      case "clearChat":
        sheet('<h2>Clear chat?</h2><p>Remove all conversation messages. Scheduled reminders remain active.</p>' + act("confirmClearChat", "Clear all messages", "row"));
        break;
      case "confirmClearChat":
        requireCompatibleBackend();
        await api("/clear-chat", {});
        outbox = []; persistLocal();
        chatGeneration++;
        selectedMessages.clear();
        selectingMessages = false;
        state.messages = [];
        replyTo = null;
        closeSheet();
        render();
        break;
      case "chatMenu":
        chatMenu();
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
          `<h2>No-reply call delay</h2><form id="escalation" class="form"><select name="delay">${[120].map((s) => `<option value="${s}">${s} seconds</option>`).join("")}</select><button type="submit" class="cta">Save</button></form>`,
        );
        break;
      case "logout":
        signOutLocal();
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
    updateComposer();
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
        await configureConnection(values.base.replace(/\/+$/, ""), boot.stt || "local");
        Object.assign(
          state,
          await api("/auth", {
            username: values.username,
            password: values.password,
          }),
        );
        boot.signedIn = "true";
        storageKey = "jazz:" + boot.base;
        persistLocal();
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
        Native.configure(values.base.trim().replace(/\/+$/, ""), boot.stt || "local");
        break;
      case "speech":
        boot.stt = values.stt;
        Native.configure(boot.base, values.stt);
        closeSheet();
        render();
        break;
      case "voicePlayback":
        Native.configureVoice(values.tts);
        closeSheet();
        toast("Voice playback saved. Start a new call to use it.");
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
  if (m.clientId) outbox = outbox.filter(item => item.clientId !== m.clientId);
  state.messages = state.messages.filter(item => !(item.status === "queued" && item.clientId === m.clientId));
  const i = state.messages.findIndex((item) => item.id === m.id);
  if (i < 0) state.messages.push(m);
  else state.messages[i] = m;
}
window.onNativeEvent = (raw) => {
  const event = typeof raw === "string" ? JSON.parse(raw) : raw;
  switch (event.type) {
    case "signedOut":
      resetConnection();
      break;
    case "configured":
      const waiter = configureWait; configureWait = null;
      if (event.changed === "true") resetConnection(event.base);
      else boot.base = event.base || boot.base;
      waiter?.resolve();
      break;
    case "cameraPaused":
      const wantedCamera = cameraWanted;
      cameraForeground = false;
      stopCamera();
      cameraWanted = wantedCamera;
      break;
    case "cameraResumed":
      if (boot.signedIn === "true") sync();
      cameraForeground = true;
      if (cameraWanted && page === "call" && currentCall?.cameraMode) startCamera();
      break;
    case "cameraPermission":
      if (event.granted === "true" && cameraWanted) startCamera();
      else { cameraWanted = false; toast("Allow camera access to use camera-assisted calls."); }
      break;
    case "savedImage":
      toast("Image saved");
      break;
    case "microphonePermission":
      if (event.granted === "true" && afterMicrophone) {
        const action = afterMicrophone;
        afterMicrophone = null;
        action();
      } else toast("Allow microphone access to use voice calls.");
      break;
    case "connection":
      connection = event.status;
      if (connection === "Connected") { sync(); flushOutbox(); }
      if (page !== "call" && page !== "login") render();
      break;
    case "sync":
      reconcile(event);
      flushOutbox();
      if (page !== "call" && page !== "login") render();
      break;
    case "outbox.delivered":
      sync();
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
    case "chat.cleared":
      chatGeneration++;
      selectedMessages.clear();
      selectingMessages = false;
      state.messages = [];
      replyTo = null;
      streamingText = "";
      clearTimeout(streamingTimer);
      streamingTimer = null;
      render();
      break;
    case "messages.deleted":
      removeMessages(event.ids);
      render();
      break;
    case "message.deleted":
      state.messages = state.messages.filter(m => m.id !== event.id);
      for (const m of state.messages) if (m.replyTo === event.id) delete m.replyTo;
      if (replyTo?.id === event.id) replyTo = null;
      render();
      break;
    case "mode.updated":
      state.assistantMode = event.assistantMode;
      state.assistantModel = event.assistantModel;
      if (page === "chat") render();
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
      persistLocal();
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
      reconcile(event);
      if (page !== "call") render();
      break;
    case "openCall":
      currentCall =
        typeof event.call === "string" ? JSON.parse(event.call) : event.call;
      show("call");
      if (event.answer === "true") answer();
      break;
    case "call.incoming":
      if (!state.calls.some(c => c.id === event.call.id)) state.calls.push(event.call);
      if (page !== "call" && page !== "login")
        toast("Jazz is calling. Open the call notification to answer.");
      break;
    case "call.ended":
    case "call.updated":
      if (event.call && endedCalls.has(event.call.id)) event.call.status = "ended";
      const callIndex = state.calls.findIndex(c => c.id === event.call?.id);
      if (callIndex >= 0) state.calls[callIndex] = event.call;
      else if (event.call) state.calls.push(event.call);
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
      endedCalls.add(event.id);
      persistLocal();
      state.calls = state.calls.map(c => c.id === event.id ? {...c, status: "ended"} : c);
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
      if (configureWait) { configureWait.reject(new Error(event.error)); configureWait = null; }
      toast(event.error);
      break;
    case "dictation":
      if (event.text) {
        show("chat");
        $("#message").value = event.text;
        updateComposer();
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
  callStarted = Date.parse(currentCall.updatedAt || currentCall.createdAt) || Date.now();
  page = "call";
  render();
  if (boot.autoAnswer && !boot.voiceRunning) answer();
  else if (currentCall.status === "active")
    if (!boot.voiceRunning) Native.voice(JSON.stringify(currentCall));
  api("/sync")
    .then((data) => {
      reconcile(data);
      if (page === "call") renderCall();
    })
    .catch((e) => toast(e.message));
} else if (boot.signedIn === "true") {
  render();
  sync();
} else show("login");
