import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  FileText,
  Globe,
  Laptop,
  Menu,
  MessageSquare,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Plus,
  Send,
  Settings,
  Smartphone,
  Sun,
  Zap
} from "lucide-react";
import "./styles.css";

interface Message {
  id: number;
  sender: "user" | "jazz";
  text: string;
  time: string;
}

interface ReminderItem {
  id: string;
  title: string;
  time: string;
}

const initialMessages: Message[] = [
  { id: 1, sender: "user", text: "Hey Jazz, what's the weather like today?", time: "10:30 AM" },
  {
    id: 2,
    sender: "jazz",
    text: "Good morning, Mama! ☀️\n\nThe weather today is looking pleasant.\n\n• Temperature: 28°C\n• Condition: Partly Cloudy\n• Humidity: 62%\n• Wind: 10 km/h\n\nIt's a pleasant day! Perfect for a walk or getting some fresh air. ☀️",
    time: "10:31 AM"
  },
  { id: 3, sender: "user", text: "Hey Jazz, remind me to call Mom at 7 PM.", time: "10:32 AM" },
  { id: 4, sender: "jazz", text: "Okay Mama, I will remind you to call Mom today at 7:00 PM.\n\n✅ Reminder set successfully!", time: "10:32 AM" }
];

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

async function apiJson(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || "Request failed");
  return data;
}

function App() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    apiJson("/api/reminders")
      .then(data => setReminders(data.items || []))
      .catch(() => setReminders([]));
  }, []);

  const addJazzMessage = (text: string) => {
    setMessages(current => [...current, { id: Date.now() + Math.random(), sender: "jazz", text, time: nowTime() }]);
  };

  const sendMessage = async () => {
    const value = input.trim();
    if (!value) return;
    setMessages(current => [...current, { id: Date.now(), sender: "user", text: value, time: nowTime() }]);
    setInput("");
    try {
      const data = await apiJson("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: value })
      });
      addJazzMessage(data.assistant || "Jazz is ready.");
    } catch {
      addJazzMessage("I couldn't reach the Jazz API. Start the API service on port 8787 and try again.");
    }
  };

  const newChat = () => setMessages([{ id: Date.now(), sender: "jazz", text: "New chat started, Mama. What are we building?", time: nowTime() }]);

  const takeNote = async () => {
    const content = window.prompt("What should Jazz remember?")?.trim();
    if (!content) return;
    try {
      await apiJson("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      addJazzMessage("✅ Saved that note to Jazz memory for this session.");
    } catch (error) {
      addJazzMessage(`I couldn't save the note: ${error instanceof Error ? error.message : "request failed"}`);
    }
  };

  const setReminder = async () => {
    const title = window.prompt("Reminder text")?.trim();
    if (!title) return;
    const time = window.prompt("Reminder time", "Today, 7:00 PM")?.trim();
    if (!time) return;
    try {
      const data = await apiJson("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, time })
      });
      setReminders(current => [...current, data.item]);
      addJazzMessage(`✅ Reminder set: ${title} — ${time}`);
    } catch (error) {
      addJazzMessage(`I couldn't create the reminder: ${error instanceof Error ? error.message : "request failed"}`);
    }
  };

  const openCalendar = () => window.open("https://calendar.google.com/", "_blank", "noopener,noreferrer");
  const searchWeb = () => window.open(`https://www.google.com/search?q=${encodeURIComponent(input || "Jazz AI Assistant")}`, "_blank", "noopener,noreferrer");

  return <div className="jazz-app">
    <div className="background-glow glow-one" /><div className="background-glow glow-two" />
    {sidebarOpen && <div className="mobile-overlay" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <div className="brand"><div className="brand-logo"><Wave /></div><div className="brand-name"><span>Jazz</span><strong>AI Assistant</strong></div></div>
      <button className="new-chat-button" onClick={newChat}><Plus size={21} /> <span>New Chat</span></button>
      <nav className="navigation">
        <NavItem icon={<MessageSquare size={20} />} text="Chat" active />
        <NavItem icon={<FileText size={20} />} text="Memory" />
        <NavItem icon={<FileText size={20} />} text="Knowledge Base" />
        <NavItem icon={<Check size={20} />} text="Tasks" />
        <NavItem icon={<Bell size={20} />} text="Reminders" />
        <NavItem icon={<CalendarDays size={20} />} text="Calendar" />
        <NavItem icon={<Laptop size={20} />} text="Devices" dropdown />
        <NavItem icon={<Settings size={20} />} text="Settings" />
      </nav>
      <div className="sidebar-bottom"><div className="assistant-card"><div className="assistant-card-title"><span>Jazz</span> AI Assistant</div><p>Always here to help you</p><div className="assistant-orb"><div className="orb-ring ring-one" /><div className="orb-ring ring-two" /><div className="orb-core"><MiniWave /></div></div></div></div>
    </aside>
    <main className="main-content">
      <header className="top-header"><button className="mobile-menu" onClick={() => setSidebarOpen(true)}><Menu size={23} /></button><div className="greeting"><h1>Good Morning, Mama <span>👋</span></h1><p>How can I help you today?</p></div><div className="header-actions"><button className="icon-button microphone-button" title="Microphone"><Mic size={21} /></button><button className="icon-button notification-button"><Bell size={20} /><span className="notification-count">3</span></button><button className="icon-button"><Sun size={20} /></button><div className="profile"><div className="profile-avatar">M</div><div className="profile-info"><strong>Gunakarna</strong><span><i />Online</span></div></div></div></header>
      <div className="dashboard-grid">
        <section className="chat-panel"><div className="chat-messages">{messages.map(message => <ChatMessage key={message.id} message={message} />)}</div><div className="message-area"><div className="message-input"><button className="input-icon"><Paperclip size={20} /></button><input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMessage()} placeholder="Type a message..."/><button className="input-icon"><Mic size={20} /></button></div><button className="send-button" onClick={sendMessage}><Send size={21} /></button></div></section>
        <aside className="right-panel">
          <DashboardCard icon={<Zap size={20} />} title="Quick Actions"><div className="quick-actions"><QuickAction icon={<FileText />} label="Take a Note" onClick={takeNote} /><QuickAction icon={<Bell />} label="Set Reminder" onClick={setReminder} /><QuickAction icon={<CalendarDays />} label="Open Calendar" onClick={openCalendar} /><QuickAction icon={<Globe />} label="Search Web" onClick={searchWeb} /></div></DashboardCard>
          <DashboardCard icon={<Smartphone size={20} />} title="Devices" action="See all"><div className="device-list"><Device icon={<Smartphone />} name="Android Phone" /><Device icon={<Laptop />} name="Windows PC" /></div></DashboardCard>
          <DashboardCard icon={<Bell size={20} />} title="Upcoming Reminders" action="See all"><div className="reminder-list">{reminders.length ? reminders.map(item => <Reminder key={item.id} icon={<Phone />} title={item.title} date={item.time} />) : <Reminder icon={<Phone />} title="No reminders yet" date="Use Set Reminder" />}</div></DashboardCard>
          <div className="status-card"><div className="status-header"><div className="status-title"><div className="status-icon"><Zap size={19} /></div><strong>Jazz Status</strong></div><span className="online-badge">Online</span></div><p>Ready to assist you!</p><div className="status-wave">{Array.from({length: 10}, (_, i) => <span key={i} />)}</div></div>
        </aside>
      </div><footer>Jazz AI Assistant v1.0.0</footer>
    </main>
  </div>;
}

function Wave() { return <div className="brand-wave">{[1,2,3,4,5].map(i => <span key={i} />)}</div>; }
function MiniWave() { return <div className="mini-wave">{[1,2,3,4,5].map(i => <span key={i} />)}</div>; }
function NavItem({ icon, text, active=false, dropdown=false }: { icon: React.ReactNode; text: string; active?: boolean; dropdown?: boolean }) { return <button className={`nav-item ${active ? "active" : ""}`}>{icon}<span>{text}</span>{dropdown && <ChevronDown size={17} className="nav-dropdown" />}</button>; }
function ChatMessage({ message }: { message: Message }) { return message.sender === "user" ? <div className="user-message-row"><div className="user-message"><div className="message-text">{message.text}</div><div className="message-time">{message.time}<Check size={13} /><Check size={13} className="second-check" /></div></div></div> : <div className="jazz-message-row"><div className="jazz-avatar"><Wave /></div><div className="jazz-message"><div className="message-text">{message.text.split("\n").map((line, i) => <div key={i}>{line || <br />}</div>)}</div><div className="message-time">{message.time}</div></div></div>; }
function DashboardCard({ icon, title, action, children }: { icon: React.ReactNode; title: string; action?: string; children: React.ReactNode }) { return <div className="dashboard-card"><div className="card-header"><div className="card-title"><span className="card-icon">{icon}</span><strong>{title}</strong></div>{action && <button className="card-action">{action}</button>}</div>{children}</div>; }
function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) { return <button className="quick-action" onClick={onClick}><span>{icon}</span>{label}</button>; }
function Device({ icon, name }: { icon: React.ReactNode; name: string }) { return <div className="device"><div className="device-icon">{icon}</div><div className="device-info"><strong>{name}</strong><span><i />Online</span></div><button className="more-button"><MoreVertical size={18} /></button></div>; }
function Reminder({ icon, title, date }: { icon: React.ReactNode; title: string; date: string }) { return <div className="reminder"><div className="reminder-icon">{icon}</div><div><strong>{title}</strong><span>{date}</span></div></div>; }

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
