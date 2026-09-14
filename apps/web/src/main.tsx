import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Bell, Bot, BrainCircuit, CalendarDays, Camera, Check,
  ChevronDown, ChevronLeft, Code2, FileText, Globe, ImagePlus, Instagram,
  Laptop, Menu, MessageSquare, Mic, Moon, Music2, Paperclip, Plus, Search,
  Send, Settings2, Smartphone, Sparkles, Timer, Volume2, Wand2, Webhook,
  X, Youtube, Zap
} from "lucide-react";
import { createRoot } from "react-dom/client";
import { JazzVoice } from "./voice";
import "./styles.css";

interface Message { id: number; sender: "user" | "jazz"; text: string; time: string; }
interface ReminderItem { id: string; title: string; time: string; }
interface DeviceItem { id: string; name: string; kind: string; status: string; bridge: boolean; }
type DayMode = "morning" | "afternoon" | "evening" | "night";

type QuickCommand = {
  label: string;
  icon: React.ReactNode;
  run: () => void | Promise<void>;
};

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
async function apiJson(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || "Request failed");
  return data;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [input, setInput] = useState("");
  const [activeMode, setActiveMode] = useState("AI Chat");
  const [activeNav, setActiveNav] = useState("Chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "speaking" | "unsupported">("idle");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [profileImage, setProfileImage] = useState<string>(() => localStorage.getItem("jazz-profile-image") || "");
  const [dayMode, setDayMode] = useState<DayMode>(() => getDayMode());
  const [searchOpen, setSearchOpen] = useState(false);
  const [showAllDevices, setShowAllDevices] = useState(false);
  const [showFeatures, setShowFeatures] = useState(false);
  const [toast, setToast] = useState("");
  const voiceRef = useRef<JazzVoice | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const profileInputRef = useRef<HTMLInputElement | null>(null);
  const greeting = greetingFor(dayMode);

  useEffect(() => {
    const timer = window.setInterval(() => setDayMode(getDayMode()), 30_000);
    apiJson("/api/reminders").then(data => setReminders(data.items || [])).catch(() => setReminders([]));
    apiJson("/api/devices").then(data => setDevices(data.items || [])).catch(() => setDevices([]));
    const voice = new JazzVoice({
      onState: state => setVoiceState(state),
      onInterim: text => { setVoiceTranscript(text); setInput(text); },
      onFinal: text => {
        const value = text.trim();
        setVoiceTranscript(value);
        if (value) {
          voice.stop();
          setInput(value);
          void sendMessage(value, voice);
        }
      },
      onError: message => addJazzMessage(message)
    });
    voiceRef.current = voice;
    setMessages([{ id: Date.now(), sender: "jazz", text: "Hey Mama 👋 Jazz is online and ready.", time: nowTime() }]);
    return () => { window.clearInterval(timer); voice.stop(); };
  }, []);

  useEffect(() => { messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(""), 2400); return () => window.clearTimeout(t); }, [toast]);

  const addJazzMessage = (text: string) => setMessages(current => [...current, { id: Date.now() + Math.random(), sender: "jazz", text, time: nowTime() }]);
  const speak = (text: string) => voiceRef.current?.speak(text.replace(/[*_#]/g, ""));

  const sendMessage = async (valueOverride?: string, voice?: JazzVoice) => {
    const value = (valueOverride ?? input).trim();
    if (!value) return;
    voice?.stop();
    setMessages(current => [...current, { id: Date.now(), sender: "user", text: value, time: nowTime() }]);
    setInput(""); setVoiceTranscript("");
    try {
      const data = await apiJson("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: value }) });
      const reply = data.assistant || "Jazz is ready.";
      addJazzMessage(reply); (voice || voiceRef.current)?.speak(reply);
    } catch {
      const reply = "Jazz could not reach the API. Start the API on port 8787 and try again.";
      addJazzMessage(reply); (voice || voiceRef.current)?.speak(reply);
    }
  };

  const toggleVoice = () => {
    if (!voiceRef.current?.isSupported()) { setVoiceState("unsupported"); addJazzMessage("Voice recognition is not supported here. Chrome or Edge is recommended."); return; }
    if (voiceState === "listening") voiceRef.current.stop(); else voiceRef.current.start();
  };
  const newChat = () => {
    setActiveNav("Chat");
    setShowFeatures(true);
    setMessages([{ id: Date.now(), sender: "jazz", text: "New chat started, Mama. I’m ready.", time: nowTime() }]);
  };

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
    try {
      const data = await apiJson("/api/device-command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: device.id, action, args, approved: true }) });
      const text = data.message || `Command sent to ${device.name}.`; setToast(text); addJazzMessage(text); speak(text);
    } catch (error) { addJazzMessage(`I couldn’t control ${device.name}: ${error instanceof Error ? error.message : "Device command failed"}`); }
  };

  const preferredAndroid = devices.find(d => d.kind === "android" && d.bridge) || devices.find(d => d.kind === "android");
  const quickCommands: QuickCommand[] = useMemo(() => [
    { label: "Open YouTube", icon: <Youtube size={17} />, run: () => preferredAndroid && void runAndroidCommand(preferredAndroid, "launch_app", { packageName: "com.google.android.youtube" }) },
    { label: "Send WhatsApp", icon: <Webhook size={17} />, run: () => preferredAndroid && void runAndroidCommand(preferredAndroid, "launch_app", { packageName: "com.whatsapp" }) },
    { label: "Take a screenshot", icon: <Camera size={17} />, run: () => { setToast("Screenshot action is reserved for the Android bridge"); addJazzMessage("Screenshot is the next bridge action to enable; the UI control is ready."); } },
    { label: "Open Instagram", icon: <Instagram size={17} />, run: () => preferredAndroid && void runAndroidCommand(preferredAndroid, "launch_app", { packageName: "com.instagram.android" }) },
    { label: "Play music", icon: <Music2 size={17} />, run: () => preferredAndroid && void runAndroidCommand(preferredAndroid, "launch_app", { packageName: "com.google.android.apps.youtube.music" }) }
  ], [preferredAndroid, devices]);

  const quickActionList: QuickCommand[] = [
    { label: "Take a Note", icon: <FileText size={17} />, run: takeNote },
    { label: "Set Reminder", icon: <Bell size={17} />, run: setReminder },
    { label: "Open Calculator", icon: <Timer size={17} />, run: () => preferredAndroid && void runAndroidCommand(preferredAndroid, "launch_app", { packageName: "com.android.calculator2" }) },
    { label: "Search Web", icon: <Search size={17} />, run: searchWeb },
    { label: "Translate", icon: <Globe size={17} />, run: () => window.open("https://translate.google.com/", "_blank", "noopener,noreferrer") },
    { label: "Generate Image", icon: <ImagePlus size={17} />, run: () => { setActiveMode("Creative"); setInput("Create an image of "); } }
  ];

  const onProfileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => { const result = typeof reader.result === "string" ? reader.result : ""; if (result) { setProfileImage(result); localStorage.setItem("jazz-profile-image", result); } };
    reader.readAsDataURL(file);
  };
  const visibleDevices = showAllDevices ? devices : devices.slice(0, 3);

  return <div className={`jazz-app mode-${dayMode}`}>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" /><div className="ambient-grid" />
    {sidebarOpen && <div className="mobile-overlay" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <div className="sidebar-topline"><div className="brand"><div className="brand-logo"><Wave /></div><div className="brand-copy"><strong>Jazz</strong><span>AI Assistant</span><small>Always there. Always with you.</small></div></div><button className="collapse-button"><ChevronLeft size={17} /></button></div>
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
      <div className="sidebar-assistant-card"><div className="assistant-card-label"><strong>Jazz</strong> AI Assistant</div><span>Voice assistant active</span><div className="assistant-orb"><div className="assistant-orb-ring r1" /><div className="assistant-orb-ring r2" /><div className="assistant-orb-core"><MiniWave /></div></div></div>
      <button className="customize-button" onClick={() => { setActiveNav("Settings"); setToast("Customize Hub opened"); }}><Wand2 size={16} /> Customize Hub</button>
      <div className="sidebar-wave-strip">{Array.from({ length: 34 }, (_, i) => <i key={i} style={{ height: `${5 + ((i * 7) % 22)}px` }} />)}</div>
    </aside>

    <main className="main-content">
      <header className="top-header"><button className="mobile-menu" onClick={() => setSidebarOpen(true)}><Menu size={22} /></button><div className="greeting"><h1>{greeting.title}</h1><p><span>Jazz is <b>online</b></span> and ready to assist you.</p></div><div className="top-search" onClick={() => setSearchOpen(true)}><Search size={17} /><span>Search anything...</span><kbd>Ctrl K</kbd></div><div className="header-actions"><button className={`round-button ${voiceState === "listening" ? "active" : ""}`} onClick={toggleVoice} title="Talk to Jazz"><Mic size={18} /></button><button className="round-button notification-button"><Bell size={18} /><span>3</span></button><div className="profile clickable" onClick={() => profileInputRef.current?.click()}>{profileImage ? <img src={profileImage} alt="Profile" className="profile-image" /> : <div className="profile-avatar">G</div>}<div className="profile-info"><strong>Gunakarna</strong><span><i />Online</span></div></div><input ref={profileInputRef} type="file" accept="image/*" onChange={onProfileSelected} hidden /></div></header>

      <div className="dashboard-scroll"><div className="dashboard-grid">
        <section className="center-column">
          <div className="mode-tabs">{["AI Chat", "Code Assistant", "Web Search", "Summarize", "Creative"].map((tab, i) => <button key={tab} className={activeMode === tab ? "active" : ""} onClick={() => setActiveMode(tab)}>{i === 0 ? <Bot /> : i === 1 ? <Code2 /> : i === 2 ? <Search /> : i === 3 ? <FileText /> : <Sparkles />}{tab}</button>)}</div>
          <section className="chat-panel"><div className="chat-panel-glow" /><div className="chat-messages" ref={messagesRef}>{messages.map(message => <ChatMessage key={message.id} message={message} />)}</div>{voiceState === "listening" && <VoiceListeningBubble transcript={voiceTranscript} />}<div className="composer-wrap"><div className="composer"><button className="composer-icon"><Paperclip size={18} /></button><input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && void sendMessage()} placeholder={voiceState === "listening" ? "Listening…" : "Type a message or use the microphone..."} /><button className={`composer-icon ${voiceState === "listening" ? "voice-on" : ""}`} onClick={toggleVoice}><Mic size={18} /></button></div><button className="send-button" onClick={() => void sendMessage()}><Send size={19} /></button></div><div className="suggestion-row"><Suggestion label="Summarize this page" icon={<FileText />} onClick={() => setInput("Summarize this page")} /><Suggestion label="Remind me at 8 PM" icon={<Timer />} onClick={setReminder} /><Suggestion label="Show my tasks" icon={<Check />} onClick={() => addJazzMessage("Your current dashboard shows 12 of 18 tasks completed.")} /><Suggestion label="Open WhatsApp" icon={<Webhook />} onClick={() => preferredAndroid && void runAndroidCommand(preferredAndroid, "launch_app", { packageName: "com.whatsapp" })} /><Suggestion label="Today’s agenda" icon={<CalendarDays />} onClick={openCalendar} /></div></section>
          {showFeatures && <section className="feature-card"><div className="section-heading"><div><span className="heading-icon"><Sparkles size={16} /></span><strong>Powerful Features</strong></div></div><div className="feature-grid"><Feature icon={<Bot />} title="AI Agents" sub="Autonomous task" badge="NEW" /><Feature icon={<Webhook />} title="Automation" sub="Smart workflows" /><Feature icon={<FileText />} title="Knowledge" sub="Your knowledge base" /><Feature icon={<Code2 />} title="Code Assistant" sub="Write & debug code" /><Feature icon={<FileText />} title="File Analyzer" sub="Analyze any file" /><Feature icon={<Search />} title="Web Search" sub="Real-time results" /><Feature icon={<Mic />} title="Voice Control" sub="Hands-free control" /><Feature icon={<ImagePlus />} title="Image Generation" sub="Create with AI" /></div></section>}
        </section>

        <aside className="right-column">
          <DashboardCard icon={<Sparkles />} title="Quick Actions" action="Edit"><div className="quick-actions-grid">{quickActionList.map(action => <QuickAction key={action.label} {...action} />)}</div></DashboardCard>
          <DashboardCard icon={<Smartphone />} title="Devices" action={showAllDevices ? "Collapse" : "See all"} actionClick={() => setShowAllDevices(v => !v)}><div className="device-list">{(visibleDevices.length ? visibleDevices : [{ id: "android-phone", name: "Android Phone", kind: "android", status: "not configured", bridge: false }]).map(device => <DeviceRow key={device.id} device={device} onClick={() => setShowAllDevices(true)} />)}</div></DashboardCard>
          <DashboardCard icon={<Bell />} title="Upcoming Reminders" action="See all"><div className="reminder-list">{reminders.length ? reminders.slice(0, 3).map(item => <ReminderRow key={item.id} item={item} />) : <div className="empty-row">No reminders yet. Use Set Reminder.</div>}</div></DashboardCard>
          <div className="status-card"><div className="status-top"><div><div className="status-heading"><span className="status-icon"><Zap size={16} /></span><strong>Jazz Status</strong></div><p>Voice assistant ready • {voiceState === "listening" ? "listening..." : "online"}</p></div><span className="online-badge">Online</span></div><div className="status-wave">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ height: `${6 + ((i * 11) % 27)}px` }} />)}</div></div>
        </aside>
      </div>

      <section className="analytics-row"><div className="activity-card"><div className="analytics-heading"><div><span className="heading-icon blue"><Activity size={16} /></span><strong>Activity Overview</strong></div><button>This Week <ChevronDown size={14} /></button></div><div className="activity-content"><div className="productivity-ring"><span>68%</span><small>Productivity Score</small></div><div className="activity-legend"><Legend dot="purple" label="Chats" value="42%" /><Legend dot="cyan" label="Tasks" value="28%" /><Legend dot="green" label="Automations" value="18%" /><Legend dot="blue" label="Learning" value="12%" /></div></div></div></section></div>

      <div className="command-bar"><div className="command-title"><span className="command-orb"><Mic size={16} /></span><strong>Quick Voice Command</strong></div>{quickCommands.map(command => <button key={command.label} onClick={() => void command.run()}>{command.icon}<span>{command.label}</span></button>)}<button className="all-commands" onClick={() => addJazzMessage("Available commands: device info, open URL, launch app, home, back, recents, notifications, tap, swipe, click text, read screen.")}>Show all commands <ChevronLeft size={16} className="rotate-180" /></button></div>
    </main>

    {searchOpen && <div className="search-overlay" onClick={() => setSearchOpen(false)}><div className="search-dialog" onClick={e => e.stopPropagation()}><div className="search-line"><Search size={20} /><input autoFocus placeholder="Search Jazz..." onKeyDown={e => { if (e.key === "Escape") setSearchOpen(false); if (e.key === "Enter") { setInput((e.target as HTMLInputElement).value); setSearchOpen(false); } }} /><button onClick={() => setSearchOpen(false)}><X size={18} /></button></div><p>Press Enter to place the query in the chat composer.</p></div></div>}
    {toast && <div className="toast"><Check size={15} />{toast}</div>}
  </div>;
}

function NavItem({ icon, text, active, badge, dropdown, onClick }: { icon: React.ReactNode; text: string; active?: boolean; badge?: string; dropdown?: boolean; onClick?: () => void }) { return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>{React.cloneElement(icon as React.ReactElement, { size: 18 })}<span>{text}</span>{badge && <em>{badge}</em>}{dropdown && <ChevronDown size={15} className="nav-chevron" />}</button>; }
function ChatMessage({ message }: { message: Message }) { return message.sender === "user" ? <div className="message-row user-row"><div className="user-bubble"><div>{message.text}</div><small>{message.time}<Check size={12} /><Check size={12} className="check-overlap" /></small></div></div> : <div className="message-row jazz-row"><div className="jazz-avatar"><Wave /></div><div className="jazz-bubble"><div>{message.text}</div><small>{message.time}</small></div></div>; }
function VoiceListeningBubble({ transcript }: { transcript: string }) { return <div className="voice-listening-layer"><div className="voice-listening-bubble"><div className="voice-orb"><Mic size={18} /></div><div className="voice-copy"><strong>Jazz is listening...</strong><span>{transcript || "Speak naturally..."}</span></div><div className="voice-bars">{Array.from({ length: 13 }, (_, i) => <i key={i} style={{ animationDelay: `${i * 55}ms` }} />)}</div></div></div>; }
function Wave() { return <div className="wave-logo">{Array.from({ length: 7 }, (_, i) => <i key={i} style={{ height: `${8 + Math.abs(3 - i) * 4 + (i === 3 ? 10 : 0)}px` }} />)}</div>; }
function MiniWave() { return <div className="mini-wave">{Array.from({ length: 7 }, (_, i) => <i key={i} style={{ height: `${7 + (i === 3 ? 11 : i % 3 * 3)}px` }} />)}</div>; }
function Stat({ label, value }: { label: string; value: string }) { return <div className="stat"><span>{label}</span><strong>{value}</strong></div>; }
function Suggestion({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) { return <button onClick={onClick}>{React.cloneElement(icon as React.ReactElement, { size: 13 })}{label}</button>; }
function QuickAction({ label, icon, run }: QuickCommand) { return <button className="quick-action" onClick={() => void run()}>{icon}<span>{label}</span></button>; }
function DashboardCard({ icon, title, action, actionClick, children }: { icon: React.ReactNode; title: string; action?: string; actionClick?: () => void; children: React.ReactNode }) { return <section className="dashboard-card"><div className="card-heading"><div><span className="card-icon">{React.cloneElement(icon as React.ReactElement, { size: 16 })}</span><strong>{title}</strong></div>{action && <button onClick={actionClick}>{action}</button>}</div>{children}</section>; }
function DeviceRow({ device, onClick }: { device: DeviceItem; onClick: () => void }) { return <button className="device-row" onClick={onClick}><span className="device-icon">{device.kind === "android" ? <Smartphone size={18} /> : <Laptop size={18} />}</span><span className="device-copy"><strong>{device.name}</strong><small className={device.bridge ? "ok" : "muted"}>{device.bridge ? `Connected · ${device.status === "configured" ? "100%" : device.status}` : "Not configured"}</small></span><Volume2 size={15} /></button>; }
function ReminderRow({ item }: { item: ReminderItem }) { return <div className="reminder-row"><span className="reminder-icon"><Bell size={15} /></span><span><strong>{item.title}</strong><small>{item.time}</small></span></div>; }
function Feature({ icon, title, sub, badge }: { icon: React.ReactNode; title: string; sub: string; badge?: string }) { return <div className="feature"><span className="feature-icon">{React.cloneElement(icon as React.ReactElement, { size: 17 })}</span><span><strong>{title}</strong><small>{sub}</small></span>{badge && <em>{badge}</em>}</div>; }
function Legend({ dot, label, value }: { dot: string; label: string; value: string }) { return <div className="legend"><span className={`dot ${dot}`} /><span>{label}</span><strong>{value}</strong></div>; }

createRoot(document.getElementById("root")!).render(<App />);
