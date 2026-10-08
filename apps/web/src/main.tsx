import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Bell, Bot, BrainCircuit, CalendarDays, Camera, Check, Copy,
  ChevronDown, ChevronLeft, ChevronRight, Code2, FileText, Globe, ImagePlus, Instagram,
  Laptop, Menu, MessageSquare, Mic, MoreHorizontal, Music2, Paperclip, Plus, Search, Share2,
  Send, Settings2, Smartphone, Sparkles, ThumbsDown, ThumbsUp, Timer, Volume2, Wand2, Webhook,
  X, Youtube, Zap
} from "lucide-react";
import { createRoot } from "react-dom/client";
import { JazzVoice } from "./voice";
import { TelegramPanel } from "./TelegramPanel";
import { MessageContent } from "./components/chat/MessageContent";
import "./styles.css";
import "./chat-overrides.css";
import "./chat-attachments.css";

interface Message { id: number; sender: "user" | "jazz"; text: string; time: string; }
interface ReminderItem { id: string; title: string; time: string; }
interface DeviceItem {
  id: string;
  name: string;
  kind: string;
  status: string;
  bridge: boolean;
  connected?: boolean;
  serial?: string | null;
  identity?: string | null;
  lastSeen?: string | null;
}
type DayMode = "morning" | "afternoon" | "evening" | "night";
type QuickCommand = { label: string; icon: React.ReactNode; run: () => void | Promise<void>; };
type MessageSource = "voice" | "typed";

const CHAT_STORAGE_KEY = "jazz-chat-history-v1";
const DRAFT_STORAGE_KEY = "jazz-chat-draft-v1";
const MODE_STORAGE_KEY = "jazz-active-mode-v1";
const NAV_STORAGE_KEY = "jazz-active-nav-v1";
const LEFT_PANEL_STORAGE_KEY = "jazz-left-panel-v1";
const RIGHT_PANEL_STORAGE_KEY = "jazz-right-panel-v1";

function getDayMode(hour = new Date().getHours()): DayMode {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}
function greetingFor(mode: DayMode) {
  if (mode === "morning") return { title: "Good Morning, Mama 👋", subtitle: "Jazz is online and ready to assist you." };
  if (mode === "afternoon") return { title: "Good Afternoon, Mama 👋", subtitle: "Jazz is online and ready to assist you." };
  if (mode === "evening") return { title: "Good Evening, Mama 👋", subtitle: "Jazz is online and ready to assist you." };
  return { title: "Good Night, Mama 👋", subtitle: "Jazz is online and ready to assist you." };
}
function nowTime() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function readStoredMessages(): Message[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item && (item.sender === "user" || item.sender === "jazz") && typeof item.text === "string" && typeof item.time === "string")
      .slice(-250)
      .map((item, index) => ({ id: Number(item.id) || Date.now() + index, sender: item.sender, text: item.text, time: item.time }));
  } catch { return []; }
}
function readStoredString(key: string, fallback: string) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function writeStoredString(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Browser storage may be unavailable or full. */ }
}
function textForVoiceReply(text: string) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/```[\s\S]*$/g, " ")
    .replace(/^\s*#{1,6}\s+(?:`[^`\n]+`|Project Structure)\s*$/gim, " ")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
async function apiJson(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || "Request failed");
  return data;
}

async function streamChat(message: string, onText: (chunk: string) => void, source: MessageSource = "typed", history: Array<{ role: "user" | "assistant"; content: string }> = []) {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ message, source, history })
  });
  if (!response.ok || !response.body) throw new Error("Streaming API unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";
    for (const event of events) {
      const dataLine = event.split(/\r?\n/).find(line => line.startsWith("data:"));
      if (!dataLine) continue;
      try {
        const data = JSON.parse(dataLine.slice(5).trim());
        if (typeof data?.text === "string") { full += data.text; onText(data.text); }
        if (data?.error) throw new Error(data.error);
      } catch (error) {
        if (error instanceof Error && error.message !== "Unexpected end of JSON input") throw error;
      }
    }
  }
  return full;
}

const UI_BUILD = "20261008-chat-artifact-route-v3";
const EXPECTED_ROUTING_BUILD = "20261008-document-route-guard-v3";

/** Only document-generation commands need this preflight. Other chat/device
 * workflows are left unchanged. The frontend must not silently send these
 * prompts to an old backend that turns them into coding-agent tasks. */
function isRequestedDocument(message: string) {
  return /^(?:(?:hey\s+jazz[,!]?[\s,]*)|(?:please\s+))*\b(?:create|generate|make|prepare|write|export|build)\b/i.test(message.trim())
    && /\b(?:pdf|word|docx|excel|xlsx|spreadsheet)\b/i.test(message.slice(0, 170));
}
async function documentRoutingWarning(message: string): Promise<string | null> {
  if (!isRequestedDocument(message)) return null;
  try {
    const response = await fetch("/api/routing/health", { cache: "no-store" });
    if (!response.ok) throw new Error("routing health endpoint missing (" + response.status + ")");
    const status = await response.json();
    const isExpected = status?.routingBuild === EXPECTED_ROUTING_BUILD && status?.documentGeneration === true;
    if (isExpected) return null;
    throw new Error("routing build " + (status?.routingBuild || "unknown"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "version check failed";
    return "**Jazz document creation is blocked because this chat is connected to an older or different API.**\n\n"
      + "Reason: " + reason + ".\n\n"
      + "This chat uses the API at the current website origin. Check the website URL and run "
      + "`verify-jazz-artifacts.ps1 -WebBaseUrl <your-web-url>` from the upgraded test project. "
      + "Update or switch the backend serving this site, then retry. No coding agent was run.";
  }
}

const ATTACHMENT_FORMATS = /\.(pdf|docx|xlsx|txt|md|csv|json|js|jsx|ts|tsx|html|css|png|jpe?g|webp)$/i;
const ATTACHMENT_LIMIT_BYTES = 4 * 1024 * 1024;

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Cannot read " + file.name));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("File reading failed"));
    reader.readAsDataURL(file);
  });
}
async function analyzeChatAttachments(message: string, files: File[], history: Array<{role: "user" | "assistant"; content: string}>) {
  const attachments = await Promise.all(files.map(async file => ({name: file.name, dataUrl: await fileDataUrl(file)})));
  return apiJson("/api/attachments/analyze", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({message, history, attachments})
  });
}
function fileSizeLabel(bytes: number) { return bytes < 1024 ? bytes + " B" : (bytes / 1024 / 1024).toFixed(2) + " MB"; }

function SelectedAttachment({file, remove}: {file: File; remove: () => void}) {
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <div className="jazz-attachment-chip">
    {preview ? <img src={preview} alt="" /> : <FileText size={18} />}
    <span><strong title={file.name}>{file.name}</strong><small>{fileSizeLabel(file.size)}</small></span>
    <button type="button" onClick={remove} title={"Remove " + file.name} aria-label={"Remove " + file.name}><X size={14} /></button>
  </div>;
}

function App() {
  const [messages, setMessages] = useState<Message[]>(() => {
    const stored = readStoredMessages();
    return stored.length ? stored : [{ id: Date.now(), sender: "jazz", text: "Hey Mama 👋 Jazz is online and ready.", time: nowTime() }];
  });
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [input, setInput] = useState(() => readStoredString(DRAFT_STORAGE_KEY, ""));
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadStatus, setUploadStatus] = useState("");
  const [activeMode, setActiveMode] = useState(() => readStoredString(MODE_STORAGE_KEY, "AI Chat"));
  const [activeNav, setActiveNav] = useState(() => readStoredString(NAV_STORAGE_KEY, "Chat"));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(() => readStoredString(LEFT_PANEL_STORAGE_KEY, "open") !== "closed");
  const [rightPanelOpen, setRightPanelOpen] = useState(() => readStoredString(RIGHT_PANEL_STORAGE_KEY, "open") !== "closed");
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "speaking" | "unsupported">("idle");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [profileImage, setProfileImage] = useState<string>(() => readStoredString("jazz-profile-image", ""));
  const [dayMode, setDayMode] = useState<DayMode>(() => getDayMode());
  const [searchOpen, setSearchOpen] = useState(false);
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [showAllDevices, setShowAllDevices] = useState(false);
  const [showFeatures, setShowFeatures] = useState(false);
  const [toast, setToast] = useState("");
  const voiceRef = useRef<JazzVoice | null>(null);
  const voiceModeRef = useRef(false);
  const voiceActivationPendingRef = useRef(false);
  const speechEpochRef = useRef(0);
  const speechQueueRef = useRef<Promise<void>>(Promise.resolve());
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const profileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const sendInFlightRef = useRef(false);
  const lastSubmissionRef = useRef<{ value: string; at: number } | null>(null);
  const greeting = greetingFor(dayMode);

  const setVoiceModeEnabled = (enabled: boolean) => {
    voiceModeRef.current = enabled;
    setVoiceMode(enabled);
  };

  const cancelSpeechQueue = () => {
    speechEpochRef.current += 1;
    speechQueueRef.current = Promise.resolve();
    voiceRef.current?.stop();
  };

  const queueSpeech = (text: string) => {
    if (!voiceModeRef.current) return false;
    const clean = textForVoiceReply(text);
    if (!clean) return false;
    const epoch = speechEpochRef.current;
    speechQueueRef.current = speechQueueRef.current
      .then(async () => {
        if (!voiceModeRef.current || epoch !== speechEpochRef.current) return;
        const voice = voiceRef.current;
        if (!voice) return;
        voice.stop();
        if (!voiceModeRef.current || epoch !== speechEpochRef.current) return;
        await voice.speak(clean);
        if (voiceModeRef.current && epoch === speechEpochRef.current) await voice.start();
      })
      .catch(() => undefined);
    return true;
  };

  const addJazzMessage = (text: string) => {
    setMessages(current => [...current, { id: Date.now() + Math.random(), sender: "jazz", text, time: nowTime() }]);
    queueSpeech(text);
  };

  const addSelectedFiles = (files: File[]) => {
    const invalid = files.find(file => !ATTACHMENT_FORMATS.test(file.name) || file.size > ATTACHMENT_LIMIT_BYTES || file.size === 0);
    if (invalid) {
      setToast("Unsupported file or over 4 MB: " + invalid.name);
      return;
    }
    setSelectedFiles(current => [...current, ...files].slice(0, 3));
    if (files.length > 3) setToast("Up to 3 files can be selected.");
  };

  const sendMessage = async (valueOverride?: string, source: MessageSource = "typed") => {
    const value = (valueOverride ?? input).trim();
    const fileBatch = source === "typed" ? selectedFiles : [];
    if ((!value && !fileBatch.length) || sendInFlightRef.current) return;
    const now = Date.now();
    if (lastSubmissionRef.current?.value === value && now - lastSubmissionRef.current.at < 1800) return;
    lastSubmissionRef.current = { value, at: now };
    const shouldSpeakReply = voiceModeRef.current;
    sendInFlightRef.current = true;

    if (voiceModeRef.current) cancelSpeechQueue();

    const recentHistory = messages
      .filter(item => item.text.trim())
      .slice(-12)
      .map(item => ({ role: item.sender === "user" ? "user" as const : "assistant" as const, content: item.text }));

    const displayText = value + (fileBatch.length ? "\n" + fileBatch.map(file => "📎 " + file.name).join("\n") : "");
    setMessages(current => [...current, { id: Date.now(), sender: "user", text: displayText, time: nowTime() }]);
    setInput(""); setVoiceTranscript("");
    const replyId = Date.now() + Math.random();
    setMessages(current => [...current, { id: replyId, sender: "jazz", text: "", time: nowTime() }]);
    let streamedReply = "";
    let speechScheduled = false;
    try {
      if (fileBatch.length) {
        setUploadStatus("Reading and analyzing attachments…");
        const result = await analyzeChatAttachments(value, fileBatch, recentHistory);
        streamedReply = result.assistant || "Jazz could not extract an answer from that file.";
        setMessages(current => current.map(item => item.id === replyId ? {...item, text: streamedReply} : item));
        setSelectedFiles([]);
      } else {
        // A real document request must not reach a stale backend as a coding task.
        const routeWarning = await documentRoutingWarning(value);
        if (routeWarning) {
          streamedReply = routeWarning;
          setMessages(current => current.map(item => item.id === replyId ? { ...item, text: routeWarning } : item));
        } else {
          await streamChat(value, chunk => {
            streamedReply += chunk;
            setMessages(current => current.map(item => item.id === replyId ? { ...item, text: item.text + chunk } : item));
          }, source, recentHistory);
        }
      }
      speechScheduled = shouldSpeakReply ? queueSpeech(streamedReply) : false;
    } catch (error) {
      if (fileBatch.length) {
        const reply = error instanceof Error ? error.message : "Attachment analysis failed.";
        setMessages(current => current.map(item => item.id === replyId ? { ...item, text: "I couldn't analyze the attachment: " + reply } : item));
        setInput(value);
      } else
      if (streamedReply.trim()) {
        speechScheduled = shouldSpeakReply ? queueSpeech(streamedReply) : false;
      } else {
        try {
          const data = await apiJson("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: value, source, history: recentHistory }) });
          const reply = data.assistant || "Jazz is ready.";
          setMessages(current => current.map(item => item.id === replyId ? { ...item, text: reply } : item));
          speechScheduled = shouldSpeakReply ? queueSpeech(reply) : false;
        } catch {
          const reply = "Jazz could not reach the local API. Check Jazz Status and try again.";
          setMessages(current => current.map(item => item.id === replyId ? { ...item, text: reply } : item));
          speechScheduled = shouldSpeakReply ? queueSpeech(reply) : false;
        }
      }
    } finally {
      setUploadStatus("");
      sendInFlightRef.current = false;
      if (shouldSpeakReply && voiceModeRef.current && !speechScheduled) void voiceRef.current?.start();
    }
  };

  useEffect(() => {
    console.info(`[Jazz UI] ${UI_BUILD}`);
    const syncPanelsForViewport = () => {
      if (window.innerWidth <= 980) {
        setSidebarOpen(false);
        setRightPanelOpen(false);
      }
    };
    syncPanelsForViewport();
    window.addEventListener("resize", syncPanelsForViewport);
    const timer = window.setInterval(() => setDayMode(getDayMode()), 30_000);
    apiJson("/api/reminders").then(data => setReminders(data.items || [])).catch(() => setReminders([]));

    const refreshDevices = () => {
      apiJson("/api/devices", { cache: "no-store" })
        .then(data => setDevices(Array.isArray(data.items) ? data.items : []))
        .catch(() => undefined);
    };
    refreshDevices();
    const deviceTimer = window.setInterval(refreshDevices, 3000);
    const onFocus = () => refreshDevices();
    const onVisibility = () => { if (!document.hidden) refreshDevices(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    const voice = new JazzVoice({
      onState: state => {
        setVoiceState(state);
        if (state === "listening" && voiceActivationPendingRef.current) {
          voiceActivationPendingRef.current = false;
          setVoiceModeEnabled(true);
        }
      },
      onInterim: text => {
        if (!voiceModeRef.current) return;
        setVoiceTranscript(text);
        setInput(text);
      },
      onFinal: text => {
        if (!voiceModeRef.current) return;
        const value = text.trim();
        setVoiceTranscript(value);
        if (value) {
          voice.stop();
          setInput(value);
          void sendMessage(value, "voice");
        }
      },
      onError: message => {
        if (voiceActivationPendingRef.current) {
          voiceActivationPendingRef.current = false;
          setVoiceModeEnabled(false);
        }
        if (/didn't hear speech|did not detect clear speech/i.test(message)) {
          if (voiceModeRef.current) window.setTimeout(() => { if (voiceRef.current === voice && voiceModeRef.current) void voice.start(); }, 250);
          return;
        }
        addJazzMessage(message);
      }
    });
    voiceRef.current = voice;
    return () => {
      window.clearInterval(timer);
      window.clearInterval(deviceTimer);
      window.removeEventListener("resize", syncPanelsForViewport);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      voiceActivationPendingRef.current = false;
      voiceModeRef.current = false;
      speechEpochRef.current += 1;
      voice.stop();
    };
  }, []);

  useEffect(() => { messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    try {
      const stable = messages.filter(item => item.text.trim()).slice(-250);
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(stable));
    } catch { /* Keep chat usable even if browser storage is full. */ }
  }, [messages]);
  useEffect(() => { writeStoredString(DRAFT_STORAGE_KEY, input); }, [input]);
  useEffect(() => { writeStoredString(MODE_STORAGE_KEY, activeMode); }, [activeMode]);
  useEffect(() => { writeStoredString(NAV_STORAGE_KEY, activeNav); }, [activeNav]);
  useEffect(() => { writeStoredString(LEFT_PANEL_STORAGE_KEY, leftPanelOpen ? "open" : "closed"); }, [leftPanelOpen]);
  useEffect(() => { writeStoredString(RIGHT_PANEL_STORAGE_KEY, rightPanelOpen ? "open" : "closed"); }, [rightPanelOpen]);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast("") , 2400); return () => window.clearTimeout(t); }, [toast]);

  const toggleVoice = () => {
    const voice = voiceRef.current;
    if (!voice?.isSupported()) {
      voiceActivationPendingRef.current = false;
      setVoiceModeEnabled(false);
      setVoiceState("unsupported");
      addJazzMessage("Voice recognition is not supported here. Chrome or Edge is recommended.");
      return;
    }

    if (voiceModeRef.current || voiceActivationPendingRef.current) {
      voiceActivationPendingRef.current = false;
      setVoiceModeEnabled(false);
      setVoiceTranscript("");
      cancelSpeechQueue();
      return;
    }

    voiceActivationPendingRef.current = true;
    void voice.start();
  };
  const toggleLeftPanel = () => {
    if (window.innerWidth <= 980 && sidebarOpen) {
      setSidebarOpen(false);
      return;
    }
    setLeftPanelOpen(open => !open);
  };
  const toggleRightPanel = () => setRightPanelOpen(open => !open);
  const newChat = () => { setActiveNav("Chat"); setShowFeatures(true); setMessages([{ id: Date.now(), sender: "jazz", text: "New chat started, Mama. I’m ready.", time: nowTime() }]); };
  const takeNote = async () => {
    const content = window.prompt("What should Jazz remember?")?.trim(); if (!content) return;
    try { await apiJson("/api/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) }); setToast("Note saved to Jazz memory"); addJazzMessage("✅ Saved that note to Jazz memory for this session."); }
    catch (error) { addJazzMessage(`I couldn’t save the note: ${error instanceof Error ? error.message : "request failed"}`); }
  };
  const setReminder = async () => {
    const title = window.prompt("Reminder text")?.trim(); if (!title) return;
    const time = window.prompt("Reminder time", "Today, 8:00 PM")?.trim(); if (!time) return;
    try { const data = await apiJson("/api/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, time }) }); setReminders(current => [...current, data.item]); addJazzMessage(`✅ Reminder set: ${title} — ${time}`); }
    catch (error) { addJazzMessage(`I couldn’t create the reminder: ${error instanceof Error ? error.message : "request failed"}`); }
  };
  const openCalendar = () => window.open("https://calendar.google.com/", "_blank", "noopener,noreferrer");
  const searchWeb = () => window.open(`https://www.google.com/search?q=${encodeURIComponent(input || "Jazz AI Assistant")}`, "_blank", "noopener,noreferrer");
  const runAndroidCommand = async (device: DeviceItem, action: string, args: Record<string, unknown> = {}) => {
    if (!device.bridge) { addJazzMessage(`${device.name} is not configured in the Windows ADB bridge yet.`); return; }
    if (!window.confirm(`Allow Jazz to send “${action}” to ${device.name}?`)) return;
    try { const data = await apiJson("/api/device-command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: device.id, action, args, approved: true }) }); const text = data.message || `Command sent to ${device.name}.`; setToast(text); addJazzMessage(text); }
    catch (error) { addJazzMessage(`I couldn’t control ${device.name}: ${error instanceof Error ? error.message : "Device command failed"}`); }
  };

  const preferredAndroid = devices.find(d => d.kind === "android" && d.bridge && d.connected)
    || devices.find(d => d.kind === "android" && d.bridge)
    || devices.find(d => d.kind === "android");
  const connectedAndroidDevices = devices.filter(d => d.kind === "android" && d.bridge && d.connected);

  const quickCommands: QuickCommand[] = useMemo(() => [
    { label: "Open YouTube", icon: <Youtube size={17} />, run: () => preferredAndroid && void runAndroidCommand(preferredAndroid, "launch_app", { packageName: "com.google.android.youtube" }) },
    { label: "Send WhatsApp", icon: <Webhook size={17} />, run: () => preferredAndroid && void runAndroidCommand(preferredAndroid, "launch_app", { packageName: "com.whatsapp" }) },
    { label: "Take a screenshot", icon: <Camera size={17} />, run: () => { setToast("Screenshot workflow is available through Jazz chat or the Android bridge."); setInput("take a screenshot of my mobile"); } },
    { label: "Open Instagram", icon: <Instagram size={17} />, run: () => preferredAndroid && void runAndroidCommand(preferredAndroid, "launch_app", { packageName: "com.instagram.android" }) },
    { label: "Play music", icon: <Music2 size={17} />, run: () => preferredAndroid && void runAndroidCommand(preferredAndroid, "launch_app", { packageName: "com.google.android.apps.youtube.music" }) }
  ], [preferredAndroid, devices]);

  const discoveredDeviceActions: QuickCommand[] = connectedAndroidDevices.map(device => ({
    label: `${device.name} • Online`,
    icon: <Smartphone size={17} />,
    run: () => {
      setActiveNav("Devices");
      setShowAllDevices(true);
      setToast(`${device.name} is connected`);
      addJazzMessage(`${device.name} is connected${device.serial ? ` via ${device.serial}` : ""}.`);
    }
  }));

  const quickActionList: QuickCommand[] = [
    ...discoveredDeviceActions,
    { label: "Take a Note", icon: <FileText size={17} />, run: takeNote },
    { label: "Set Reminder", icon: <Bell size={17} />, run: setReminder },
    { label: "Open Calculator", icon: <Timer size={17} />, run: () => preferredAndroid && void runAndroidCommand(preferredAndroid, "launch_app", { packageName: "com.android.calculator2" }) },
    { label: "Search Web", icon: <Search size={17} />, run: searchWeb },
    { label: "Telegram", icon: <Send size={17} />, run: () => setTelegramOpen(true) },
    { label: "Generate Image", icon: <ImagePlus size={17} />, run: () => { setActiveMode("Creative"); setInput("Create an image of "); } }
  ];
  const onProfileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader(); reader.onload = () => { const result = typeof reader.result === "string" ? reader.result : ""; if (result) { setProfileImage(result); writeStoredString("jazz-profile-image", result); } }; reader.readAsDataURL(file);
  };
  const visibleDevices = showAllDevices ? devices : devices.slice(0, 3);

  return <div data-ui-build={UI_BUILD} className={`jazz-app mode-${dayMode} ${leftPanelOpen ? "left-panel-open" : "left-panel-closed"} ${rightPanelOpen ? "right-panel-open" : "right-panel-closed"}`}>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" /><div className="ambient-grid" />
    {sidebarOpen && <div className="mobile-overlay" onClick={() => setSidebarOpen(false)} />}
    {rightPanelOpen && <div className="right-mobile-overlay" onClick={() => setRightPanelOpen(false)} />}
    {(leftPanelOpen || sidebarOpen) && <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <div className="sidebar-topline"><div className="brand"><div className="brand-logo"><Wave /></div><div className="brand-copy"><strong>Jazz</strong><span>AI Assistant</span><small>Always there. Always with you.</small></div></div><button className="collapse-button" onClick={() => setLeftPanelOpen(false)} title="Hide left panel" aria-label="Hide left panel"><ChevronLeft size={17} /></button></div>
      <button className="new-chat-button" onClick={newChat}><Plus size={18} /><span>New Chat</span></button>
      <nav className="navigation">
        <NavItem icon={<MessageSquare />} text="Chat" active={activeNav === "Chat"} onClick={() => setActiveNav("Chat")} />
        <NavItem icon={<Bot />} text="Agents" badge="NEW" onClick={() => { setActiveNav("Agents"); addJazzMessage("Agent workspace opened. Autonomous task flows will appear here."); }} />
        <NavItem icon={<BrainCircuit />} text="Memory" onClick={() => { setActiveNav("Memory"); addJazzMessage("Memory workspace opened. Use Take a Note to save a session memory."); }} />
        <NavItem icon={<FileText />} text="Knowledge Base" onClick={() => { setActiveNav("Knowledge Base"); addJazzMessage("Knowledge Base workspace opened."); }} />
        <NavItem icon={<Check />} text="Tasks" onClick={() => { setActiveNav("Tasks"); addJazzMessage("Tasks workspace opened."); }} />
        <NavItem icon={<Bell />} text="Reminders" onClick={() => { setActiveNav("Reminders"); addJazzMessage(`You have ${reminders.length} reminder${reminders.length === 1 ? "" : "s"}.`); }} />
        <NavItem icon={<CalendarDays />} text="Calendar" onClick={openCalendar} />
        <NavItem icon={<Smartphone />} text="Devices" dropdown onClick={() => { setActiveNav("Devices"); setShowAllDevices(true); }} />
        <NavItem icon={<Webhook />} text="Automations" onClick={() => { setActiveNav("Automations"); addJazzMessage("Automation workspace opened."); }} />
        <NavItem icon={<Activity />} text="Analytics" onClick={() => { setActiveNav("Analytics"); addJazzMessage("Analytics workspace opened."); }} />
        <NavItem icon={<Settings2 />} text="Settings" onClick={() => { setActiveNav("Settings"); addJazzMessage("Settings workspace opened."); }} />
      </nav>
      <div className="sidebar-overview"><div className="overview-title">Today’s Overview <ChevronDown size={14} /></div><div className="overview-grid"><Stat label="Tasks Completed" value="12/18" /><Stat label="Conversations" value="24" /></div><div className="overview-bottom"><div><span>Time Saved</span><strong>3.6 hrs</strong></div><div className="progress-ring"><span>75%</span></div></div></div>
      <div className="sidebar-assistant-card"><div className="assistant-card-label"><strong>Jazz</strong> AI Assistant</div><span>{voiceMode ? "Voice replies on" : "Voice replies off"}</span><div className="assistant-orb"><div className="assistant-orb-ring r1" /><div className="assistant-orb-ring r2" /><div className="assistant-orb-core"><MiniWave /></div></div></div>
      <button className="customize-button" onClick={() => { setActiveNav("Settings"); setToast("Customize Hub opened"); }}><Wand2 size={16} /> Customize Hub</button>
      <div className="sidebar-wave-strip">{Array.from({ length: 34 }, (_, i) => <i key={i} style={{ height: `${5 + ((i * 7) % 22)}px` }} />)}</div>
    </aside>}
    <main className="main-content">
      <header className="top-header"><button className="mobile-menu" onClick={() => { setLeftPanelOpen(true); setSidebarOpen(true); }}><Menu size={22} /></button><div className="greeting"><h1>{greeting.title}</h1><p><span>Jazz is <b>online</b></span> and ready to assist you.</p></div><div className="top-search" onClick={() => setSearchOpen(true)}><Search size={17} /><span>Search anything...</span><kbd>Ctrl K</kbd></div><div className="header-actions"><button className="mobile-tools-button" onClick={() => setRightPanelOpen(true)} title="Open tools"><ChevronLeft size={18} /><span>Tools</span></button>
        <button className={`round-button ${voiceMode ? "active" : ""}`} onClick={toggleVoice} title={voiceMode ? "Turn voice replies off" : "Turn voice replies on"}><Mic size={18} /></button><button className="round-button notification-button"><Bell size={18} /><span>3</span></button><div className="profile clickable" onClick={() => profileInputRef.current?.click()}>{profileImage ? <img src={profileImage} alt="Profile" className="profile-image" /> : <div className="profile-avatar">G</div>}<div className="profile-info"><strong>Gunakarna</strong><span><i />Online</span></div></div><input ref={profileInputRef} type="file" accept="image/*" onChange={onProfileSelected} hidden /></div></header>
      <div className="panel-control-row" aria-label="Dashboard panel controls">
        <button type="button" className={`panel-control panel-control-left ${leftPanelOpen ? "is-open" : "is-closed"}`} onClick={() => setLeftPanelOpen(v => !v)} aria-pressed={leftPanelOpen}>
          {leftPanelOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          <span>{leftPanelOpen ? "Hide Menu" : "Show Menu"}</span>
        </button>
        <button type="button" className={`panel-control panel-control-right ${rightPanelOpen ? "is-open" : "is-closed"}`} onClick={() => setRightPanelOpen(v => !v)} aria-pressed={rightPanelOpen}>
          <span>{rightPanelOpen ? "Hide Tools" : "Show Tools"}</span>
          {rightPanelOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
      <div className="dashboard-scroll"><div className={`dashboard-grid ${rightPanelOpen ? "with-right-panel" : "without-right-panel"}`}>
        <section className="center-column">
          <div className="mode-tabs">{["AI Chat", "Code Assistant", "Web Search", "Summarize", "Creative"].map((tab, i) => <button key={tab} className={activeMode === tab ? "active" : ""} onClick={() => setActiveMode(tab)}>{i === 0 ? <Bot /> : i === 1 ? <Code2 /> : i === 2 ? <Search /> : i === 3 ? <FileText /> : <Sparkles />}{tab}</button>)}</div>
          <section className="chat-panel"><div className="chat-panel-glow" /><div className="chat-messages" ref={messagesRef}>{messages.map(message => <ChatMessage key={message.id} message={message} />)}</div>{voiceMode && voiceState === "listening" && <VoiceListeningBubble transcript={voiceTranscript} />}<div className="composer-wrap" onDragOver={e => e.preventDefault()} onDrop={e => {e.preventDefault(); addSelectedFiles(Array.from(e.dataTransfer.files));}}>
            {(selectedFiles.length > 0 || uploadStatus) && <div className="jazz-attachment-tray" aria-live="polite">{selectedFiles.map((file, i) => <SelectedAttachment key={file.name + i} file={file} remove={() => setSelectedFiles(current => current.filter((_, j) => i !== j))} />)}{uploadStatus && <span className="jazz-upload-status">{uploadStatus}</span>}</div>}
            <input ref={attachmentInputRef} type="file" hidden multiple accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.html,.css,.png,.jpg,.jpeg,.webp" onChange={e => {addSelectedFiles(Array.from(e.target.files || []));e.target.value = "";}} />
            <div className="composer"><button type="button" className="composer-icon" title="Attach files" aria-label="Attach files" onClick={() => attachmentInputRef.current?.click()}><Paperclip size={18} /></button><input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && void sendMessage()} placeholder={voiceState === "listening" ? "Listening…" : voiceMode ? "Voice mode on — type or speak..." : "Type a message or use the microphone..."} /><button className={`composer-icon ${voiceMode ? "voice-on" : ""}`} onClick={toggleVoice} title={voiceMode ? "Turn voice replies off" : "Turn voice replies on"}><Mic size={18} /></button></div><button className="send-button" onClick={() => void sendMessage()}><Send size={19} /></button></div><div className="suggestion-row"><Suggestion label="Summarize this page" icon={<FileText />} onClick={() => setInput("Summarize this page")} /><Suggestion label="Remind me at 8 PM" icon={<Timer />} onClick={setReminder} /><Suggestion label="Show my tasks" icon={<Check />} onClick={() => addJazzMessage("Your current dashboard shows 12 of 18 tasks completed.")} /><Suggestion label="Open WhatsApp" icon={<Webhook />} onClick={() => preferredAndroid && void runAndroidCommand(preferredAndroid, "launch_app", { packageName: "com.whatsapp" })} /><Suggestion label="Today’s agenda" icon={<CalendarDays />} onClick={openCalendar} /></div></section>
          {showFeatures && <section className="feature-card"><div className="section-heading"><div><span className="heading-icon"><Sparkles size={16} /></span><strong>Powerful Features</strong></div></div><div className="feature-grid"><Feature icon={<Bot />} title="AI Agents" sub="Autonomous task" badge="NEW" /><Feature icon={<Webhook />} title="Automation" sub="Smart workflows" /><Feature icon={<FileText />} title="Knowledge" sub="Your knowledge base" /><Feature icon={<Code2 />} title="Code Assistant" sub="Write & debug code" /><Feature icon={<FileText />} title="File Analyzer" sub="Analyze any file" /><Feature icon={<Search />} title="Web Search" sub="Real-time results" /><Feature icon={<Mic />} title="Voice Control" sub="Hands-free control" /><Feature icon={<ImagePlus />} title="Image Generation" sub="Create with AI" /></div></section>}
        </section>
        {rightPanelOpen && <aside className="right-column">
          <button className="right-panel-close" onClick={() => setRightPanelOpen(false)} title="Hide right panel" aria-label="Hide right panel"><ChevronRight size={16} /></button>
          <DashboardCard icon={<Sparkles />} title="Quick Actions" action="Edit"><div className="quick-actions-grid">{quickActionList.map(action => <QuickAction key={action.label} {...action} />)}</div></DashboardCard>
          <DashboardCard icon={<Smartphone />} title="Devices" action={showAllDevices ? "Collapse" : "See all"} actionClick={() => setShowAllDevices(v => !v)}><div className="device-list">{(visibleDevices.length ? visibleDevices : [{ id: "android-phone", name: "Android Phone", kind: "android", status: "not-configured", bridge: false, connected: false }]).map(device => <DeviceRow key={device.id} device={device} onClick={() => setShowAllDevices(true)} />)}</div></DashboardCard>
          <DashboardCard icon={<Bell />} title="Upcoming Reminders" action="See all"><div className="reminder-list">{reminders.length ? reminders.slice(0, 3).map(item => <ReminderRow key={item.id} item={item} />) : <div className="empty-row">No reminders yet. Use Set Reminder.</div>}</div></DashboardCard>
          <div className="status-card"><div className="status-top"><div><div className="status-heading"><span className="status-icon"><Zap size={16} /></span><strong>Jazz Status</strong></div><p>{voiceMode ? `Voice replies on • ${voiceState === "listening" ? "listening..." : voiceState === "speaking" ? "speaking..." : "ready"}` : "Voice replies off • text only"}</p></div><span className="online-badge">Online</span></div><div className="status-wave">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ height: `${6 + ((i * 11) % 27)}px` }} />)}</div></div>
        </aside>}
      </div>
      <section className="analytics-row"><div className="activity-card"><div className="analytics-heading"><div><span className="heading-icon blue"><Activity size={16} /></span><strong>Activity Overview</strong></div><button>This Week <ChevronDown size={14} /></button></div><div className="activity-content"><div className="productivity-ring"><span>68%</span><small>Productivity Score</small></div><div className="activity-legend"><Legend dot="purple" label="Chats" value="42%" /><Legend dot="cyan" label="Tasks" value="28%" /><Legend dot="green" label="Automations" value="18%" /><Legend dot="blue" label="Learning" value="12%" /></div></div></div></section></div>
      <div className="command-bar"><div className="command-title"><span className="command-orb"><Mic size={16} /></span><strong>Quick Voice Command</strong></div>{quickCommands.map(command => <button key={command.label} onClick={() => void command.run()}>{command.icon}<span>{command.label}</span></button>)}<button className="all-commands" onClick={() => addJazzMessage("Available commands: device info, open URL, launch app, home, back, recents, notifications, tap, swipe, click text, read screen.")}>Show all commands <ChevronLeft size={16} className="rotate-180" /></button></div>
    </main>
    {searchOpen && <div className="search-overlay" onClick={() => setSearchOpen(false)}><div className="search-dialog" onClick={e => e.stopPropagation()}><div className="search-line"><Search size={20} /><input autoFocus placeholder="Search Jazz..." onKeyDown={e => { if (e.key === "Escape") setSearchOpen(false); if (e.key === "Enter") { setInput((e.target as HTMLInputElement).value); setSearchOpen(false); } }} /><button onClick={() => setSearchOpen(false)}><X size={18} /></button></div><p>Press Enter to place the query in the chat composer.</p></div></div>}
    <TelegramPanel open={telegramOpen} onClose={() => setTelegramOpen(false)} />
    {toast && <div className="toast"><Check size={15} />{toast}</div>}
  </div>;
}

function NavItem({ icon, text, active, badge, dropdown, onClick }: { icon: React.ReactNode; text: string; active?: boolean; badge?: string; dropdown?: boolean; onClick?: () => void }) { return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>{React.cloneElement(icon as React.ReactElement, { size: 18 })}<span>{text}</span>{badge && <em>{badge}</em>}{dropdown && <ChevronDown size={15} className="nav-chevron" />}</button>; }
function ChatMessage({ message }: { message: Message }) {
  if (message.sender === "user") {
    return (
      <div className="message-row user-row">
        <div className="message-content-column user-content-column">
          <div className="user-bubble"><MessageContent text={message.text} /></div>
          <div className="user-message-meta">{message.time}<Check size={12} /><Check size={12} className="check-overlap" /></div>
        </div>
        <div className="user-avatar" aria-hidden="true">G</div>
      </div>
    );
  }

  return (
    <div className="message-row jazz-row">
      <div className="jazz-avatar"><Wave /></div>
      <div className="message-content-column jazz-content-column">
        <div className="assistant-meta"><strong>Jazz</strong><span>{message.time}</span></div>
        <div className="jazz-bubble"><MessageContent text={message.text} /></div>
        <div className="message-actions" aria-hidden="true">
          <Copy size={16} />
          <ThumbsUp size={16} />
          <ThumbsDown size={16} />
          <Share2 size={16} />
          <Volume2 size={16} />
          <MoreHorizontal size={17} />
        </div>
      </div>
    </div>
  );
}

function VoiceListeningBubble({ transcript }: { transcript: string }) {
  return (
    <div className="voice-listening-layer">
      <div className="voice-listening-bubble">
        <div className="voice-orb"><Mic size={18} /></div>
        <div className="voice-copy"><strong>Jazz is listening...</strong><span>{transcript || "Speak naturally..."}</span></div>
        <div className="voice-bars">
          {Array.from({ length: 13 }, (_, i) => (
            <i key={i} style={{ animationDelay: `${i * 55}ms` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Wave() {
  return (
    <div className="wave-logo">
      {Array.from({ length: 7 }, (_, i) => (
        <i key={i} style={{ height: `${8 + Math.abs(3 - i) * 4 + (i === 3 ? 10 : 0)}px` }} />
      ))}
    </div>
  );
}

function MiniWave() {
  return (
    <div className="mini-wave">
      {Array.from({ length: 7 }, (_, i) => (
        <i key={i} style={{ height: `${7 + (i === 3 ? 11 : (i % 3) * 3)}px` }} />
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="stat"><span>{label}</span><strong>{value}</strong></div>; }
function Suggestion({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) { return <button onClick={onClick}>{React.cloneElement(icon as React.ReactElement, { size: 13 })}{label}</button>; }
function QuickAction({ label, icon, run }: QuickCommand) { return <button className="quick-action" onClick={() => void run()}>{icon}<span>{label}</span></button>; }
function DashboardCard({ icon, title, action, actionClick, children }: { icon: React.ReactNode; title: string; action?: string; actionClick?: () => void; children: React.ReactNode }) { return <section className="dashboard-card"><div className="card-heading"><div><span className="card-icon">{React.cloneElement(icon as React.ReactElement, { size: 16 })}</span><strong>{title}</strong></div>{action && <button onClick={actionClick}>{action}</button>}</div>{children}</section>; }
function DeviceRow({ device, onClick }: { device: DeviceItem; onClick: () => void }) {
  const connected = device.connected === true || device.status === "connected";
  const detail = connected
    ? `Connected${device.serial ? ` · ${device.serial}` : ""}`
    : device.bridge
      ? device.status === "discovering" ? "Discovering…" : device.status === "bridge-offline" ? "ADB bridge offline" : "Offline"
      : "Not configured";
  return <button className="device-row" onClick={onClick}><span className="device-icon">{device.kind === "android" ? <Smartphone size={18} /> : <Laptop size={18} />}</span><span className="device-copy"><strong>{device.name}</strong><small className={connected ? "ok" : "muted"}>{detail}</small></span><Volume2 size={15} /></button>;
}
function ReminderRow({ item }: { item: ReminderItem }) { return <div className="reminder-row"><span className="reminder-icon"><Bell size={15} /></span><span><strong>{item.title}</strong><small>{item.time}</small></span></div>; }
function Feature({ icon, title, sub, badge }: { icon: React.ReactNode; title: string; sub: string; badge?: string }) { return <div className="feature"><span className="feature-icon">{React.cloneElement(icon as React.ReactElement, { size: 17 })}</span><span><strong>{title}</strong><small>{sub}</small></span>{badge && <em>{badge}</em>}</div>; }
function Legend({ dot, label, value }: { dot: string; label: string; value: string }) { return <div className="legend"><span className={`dot ${dot}`} /><span>{label}</span><strong>{value}</strong></div>; }

createRoot(document.getElementById("root")!).render(<App />);
