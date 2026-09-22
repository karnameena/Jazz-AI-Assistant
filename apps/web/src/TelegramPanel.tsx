import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Bot, CheckCircle2, MessageCircle, RefreshCw, Send, X } from "lucide-react";
import "./telegram.css";

type TelegramStatus = {
  ok: boolean;
  configured: boolean;
  tokenConfigured: boolean;
  chatConfigured: boolean;
  chatId?: string;
  message?: string;
  bot?: {
    id: number;
    username: string;
    firstName: string;
  };
};

type TelegramMessage = {
  id: string;
  direction: "in" | "out";
  text: string;
  date: string;
  from: string;
};

type TelegramPanelProps = {
  open: boolean;
  onClose: () => void;
};

async function telegramJson(path: string, options?: RequestInit) {
  const response = await fetch(`/telegram-api${path}`, options);
  const data = await response.json();
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || data?.message || "Telegram request failed.");
  }
  return data;
}

function formatTelegramTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function TelegramPanel({ open, onClose }: TelegramPanelProps) {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const configured = Boolean(status?.configured && status?.tokenConfigured && status?.chatConfigured);
  const botTitle = status?.bot?.firstName || "Telegram Bot";
  const botUsername = status?.bot?.username ? `@${status.bot.username}` : "Bot not connected";

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [messages]
  );

  const loadMessages = async (quiet = false) => {
    if (!configured) return;
    if (!quiet) setLoading(true);
    try {
      const data = await telegramJson("/messages");
      setMessages(Array.isArray(data.items) ? data.items : []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Telegram messages.");
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  const loadStatus = async () => {
    setLoading(true);
    try {
      const data = await telegramJson("/status");
      setStatus(data);
      setError("");
    } catch (statusError) {
      setStatus(null);
      setError(statusError instanceof Error ? statusError.message : "Could not connect to Telegram.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadStatus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !configured) return;
    void loadMessages();
    const timer = window.setInterval(() => void loadMessages(true), 4000);
    return () => window.clearInterval(timer);
  }, [open, configured]);

  useEffect(() => {
    if (!open) return;
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || !configured || sending) return;
    setSending(true);
    try {
      const data = await telegramJson("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      if (data.item) setMessages(current => [...current.filter(item => item.id !== data.item.id), data.item]);
      setDraft("");
      setError("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send Telegram message.");
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="telegram-overlay" onMouseDown={onClose}>
      <section className="telegram-shell" onMouseDown={event => event.stopPropagation()} aria-label="Telegram in Jazz">
        <header className="telegram-header">
          <div className="telegram-heading">
            <span className="telegram-logo"><Send size={18} /></span>
            <div><strong>Telegram</strong><small>Use your Telegram bot inside Jazz</small></div>
          </div>
          <div className="telegram-header-actions">
            <button type="button" onClick={() => { void loadStatus(); if (configured) void loadMessages(); }} title="Refresh Telegram"><RefreshCw size={17} className={loading ? "telegram-spin" : ""} /></button>
            <button type="button" onClick={onClose} title="Close Telegram"><X size={19} /></button>
          </div>
        </header>

        <div className="telegram-body">
          <aside className="telegram-bot-list">
            <div className="telegram-list-title"><span>Bots</span><small>{status?.bot ? "1" : "0"}</small></div>
            {status?.bot ? (
              <button type="button" className="telegram-bot-item active">
                <span className="telegram-bot-avatar"><Bot size={19} /></span>
                <span className="telegram-bot-copy"><strong>{botTitle}</strong><small>{botUsername}</small></span>
                <span className="telegram-online-dot" />
              </button>
            ) : (
              <div className="telegram-empty-bot"><Bot size={22} /><span>No bot configured</span></div>
            )}
            <div className="telegram-connection-card">
              {configured ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              <div><strong>{configured ? "Connected" : "Setup required"}</strong><small>{status?.chatId ? `Chat ${status.chatId}` : "Local bot connection"}</small></div>
            </div>
          </aside>

          <main className="telegram-chat">
            <div className="telegram-chat-title">
              <span className="telegram-bot-avatar large"><Bot size={21} /></span>
              <div><strong>{botTitle}</strong><small>{configured ? `${botUsername} · connected` : botUsername}</small></div>
            </div>

            {!configured ? (
              <div className="telegram-setup">
                <span className="telegram-setup-icon"><Send size={26} /></span>
                <h3>Connect your Telegram bot</h3>
                <p>{status?.message || "Add your bot token and chat ID to the local Jazz configuration, then restart Jazz."}</p>
                <div className="telegram-config-box">
                  <code>services/api/.env</code>
                  <span>JAZZ_TELEGRAM_BOT_TOKEN=your_botfather_token</span>
                  <span>JAZZ_TELEGRAM_CHAT_ID=your_chat_id</span>
                </div>
                <small>The token stays on your PC and is never shown in the browser UI.</small>
              </div>
            ) : (
              <>
                <div className="telegram-messages" ref={messagesRef}>
                  {loading && !messages.length ? <div className="telegram-loading">Loading Telegram…</div> : null}
                  {!loading && !sortedMessages.length ? (
                    <div className="telegram-no-messages"><MessageCircle size={24} /><strong>No messages yet</strong><span>Send a message here, or message your bot in Telegram.</span></div>
                  ) : null}
                  {sortedMessages.map(message => (
                    <div key={message.id} className={`telegram-message-row ${message.direction === "out" ? "outgoing" : "incoming"}`}>
                      <div className="telegram-message-bubble">
                        {message.direction === "in" && <small className="telegram-sender">{message.from}</small>}
                        <div>{message.text}</div>
                        <small className="telegram-message-time">{formatTelegramTime(message.date)}</small>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="telegram-composer">
                  <input
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }}
                    placeholder={`Message ${botTitle}…`}
                    disabled={sending}
                  />
                  <button type="button" onClick={() => void sendMessage()} disabled={!draft.trim() || sending} title="Send Telegram message">
                    <Send size={18} />
                  </button>
                </div>
              </>
            )}

            {error && <div className="telegram-error"><AlertCircle size={15} />{error}</div>}
          </main>
        </div>
      </section>
    </div>
  );
}
