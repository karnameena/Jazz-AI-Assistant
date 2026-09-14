import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, Mic, Send, ShieldCheck, Sparkles, Wifi } from "lucide-react";
import "./styles.css";

function App() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<string[]>(["Hello Mama. Jazz is ready."]);

  function send() {
    const text = message.trim();
    if (!text) return;
    setMessages(prev => [...prev, `You: ${text}`, "Jazz: I received your command. Tool execution is permission-controlled."]);
    setMessage("");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><div className="orb"><Sparkles size={22} /></div><div><b>JAZZ</b><span>AI ASSISTANT</span></div></div>
        <div className="status"><Wifi size={15} /> ONLINE <ShieldCheck size={15} /> SAFE MODE</div>
      </header>
      <section className="hero">
        <div className="hero-copy"><p className="eyebrow">PERSONAL INTELLIGENCE SYSTEM</p><h1>Hey Jazz<span>.</span></h1><p>Voice, memory, tools and device control — connected through explicit permissions.</p></div>
        <div className="pulse"><Activity size={34} /><small>LISTENING READY</small></div>
      </section>
      <section className="panel">
        <div className="messages">{messages.map((m, i) => <div className={i % 2 ? "msg user" : "msg"} key={`${m}-${i}`}>{m}</div>)}</div>
        <div className="composer"><button title="Voice"><Mic size={20} /></button><input value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Talk to Jazz..."/><button onClick={send} title="Send"><Send size={19} /></button></div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
