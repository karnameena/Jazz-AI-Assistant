import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, Bot, CheckCheck, CheckCircle2, ChevronLeft, Download,
  ExternalLink, FileText, MapPin, MessageCircle, RefreshCw, Send, X
} from "lucide-react";
import "./telegram.css";

type TelegramStatus = {
  ok: boolean;
  scope?: string;
  configured: boolean;
  tokenConfigured: boolean;
  chatConfigured: boolean;
  clientConfigured?: boolean;
  realtime?: boolean;
  historyLimit?: number;
  message?: string;
  bot?: { id: number; username: string; firstName: string };
};
type TelegramKeyboardButton = {
  text: string;
  type: "reply" | "callback" | "url" | "unsupported";
  data?: string;
  url?: string;
  messageId?: number;
};
type TelegramKeyboard = { kind: "reply" | "inline"; rows: TelegramKeyboardButton[][] };
type TelegramMedia = {
  kind: "photo" | "video" | "file" | "location" | "link";
  url?: string;
  mimeType?: string;
  fileName?: string;
  size?: number;
  latitude?: number;
  longitude?: number;
  title?: string;
  description?: string;
  siteName?: string;
};
type TelegramMessage = {
  id: string;
  messageId: number;
  direction: "in" | "out";
  text: string;
  date: string;
  from: string;
  keyboard?: TelegramKeyboard;
  media?: TelegramMedia;
  forwarded?: { label: string; date?: string };
};
type TelegramPanelProps = { open: boolean; onClose: () => void };

async function telegramJson(path: string, options?: RequestInit) {
  const response = await fetch(`/telegram-api${path}`, options);
  const data = await response.json();
  if (!response.ok || data?.ok === false) throw new Error(data?.error || data?.message || "Telegram request failed.");
  return data;
}
function formatTelegramTime(value?: string) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function formatBytes(value?: number) {
  if (!value || value < 1) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
function safeExternalUrl(value?: string) {
  if (!value) return "";
  try {
    const parsed = new URL(value, window.location.href);
    return ["http:", "https:", "tg:"].includes(parsed.protocol) ? value : "";
  } catch { return ""; }
}
function mapLinks(latitude: number, longitude: number) {
  const delta = 0.004;
  const bbox = [longitude - delta, latitude - delta, longitude + delta, latitude + delta].join(",");
  return {
    embed: `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${latitude},${longitude}`)}`,
    open: `https://www.openstreetmap.org/?mlat=${encodeURIComponent(String(latitude))}&mlon=${encodeURIComponent(String(longitude))}#map=16/${latitude}/${longitude}`
  };
}

export function TelegramPanel({ open, onClose }: TelegramPanelProps) {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [selectedBot, setSelectedBot] = useState(false);
  const [botStarted, setBotStarted] = useState(false);
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [buttonBusy, setButtonBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [live, setLive] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const configured = Boolean(status?.configured && status?.chatConfigured && status?.clientConfigured);
  const botTitle = status?.bot?.firstName || status?.bot?.username || "Telegram Bot";
  const botListName = status?.bot?.username || status?.bot?.firstName || "Telegram Bot";
  const botUsername = status?.bot?.username ? `@${status.bot.username}` : "Bot not connected";
  const avatarLetter = (status?.bot?.firstName || status?.bot?.username || "K").charAt(0).toUpperCase();
  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [messages]
  );

  const applyItems = (data: any) => {
    if (Array.isArray(data?.items)) setMessages(data.items as TelegramMessage[]);
  };
  const loadMessages = async (quiet = false) => {
    if (!configured || !selectedBot) return;
    if (!quiet) setLoading(true);
    try {
      const data = await telegramJson(`/messages?limit=${status?.historyLimit || 150}`);
      applyItems(data);
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
      setSelectedBot(false);
      setError(statusError instanceof Error ? statusError.message : "Could not connect to Telegram.");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!open) return;
    setSelectedBot(false);
    setBotStarted(false);
    setMessages([]);
    setDraft("");
    setError("");
    setNotice("");
    setLive(false);
    void loadStatus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open || !configured || !selectedBot) return;
    void loadMessages();
  }, [open, configured, selectedBot]);

  useEffect(() => {
    if (!open || !configured || !selectedBot || !botStarted) { setLive(false); return; }
    const source = new EventSource("/telegram-api/events");
    const onReady = () => setLive(true);
    const onMessages = (event: MessageEvent) => {
      try { applyItems(JSON.parse(event.data)); setLive(true); setError(""); } catch {}
    };
    const onTelegramError = (event: MessageEvent) => {
      try { const data = JSON.parse(event.data); if (data?.message) setError(data.message); } catch {}
    };
    source.addEventListener("ready", onReady);
    source.addEventListener("messages", onMessages as EventListener);
    source.addEventListener("telegram-error", onTelegramError as EventListener);
    source.onerror = () => setLive(false);
    return () => { source.close(); setLive(false); };
  }, [open, configured, selectedBot, botStarted]);

  useEffect(() => {
    if (!open || !selectedBot || !botStarted) return;
    const node = messagesRef.current;
    node?.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages, open, selectedBot, botStarted]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selectBot = () => {
    if (!status?.bot) return;
    setSelectedBot(true);
    setBotStarted(false);
    setMessages([]);
    setError("");
    setNotice("");
  };
  const startBot = async () => {
    if (!configured || sending) return;
    setSending(true);
    setError("");
    try {
      const data = await telegramJson("/start", { method: "POST" });
      applyItems(data);
      setBotStarted(true);
      setNotice("/start sent through your Telegram account");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start this Telegram bot.");
    } finally { setSending(false); }
  };
  const sendText = async (text: string, clearDraft = false) => {
    const value = text.trim();
    if (!value || !configured || sending) return;
    setSending(true);
    setError("");
    try {
      const data = await telegramJson("/send", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: value })
      });
      applyItems(data);
      if (clearDraft) setDraft("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send Telegram message.");
    } finally { setSending(false); }
  };
  const sendMessage = async () => {
    const text = draft.trim();
    if (text) await sendText(text, true);
  };

  const pressKeyboardButton = async (button: TelegramKeyboardButton, fallbackMessageId: number) => {
    const busyId = `${fallbackMessageId}:${button.type}:${button.text}`;
    if (buttonBusy) return;
    if (button.type === "url") {
      const url = safeExternalUrl(button.url);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else setError(`Telegram button “${button.text}” has an invalid URL.`);
      return;
    }
    if (button.type === "unsupported") {
      setError(`Telegram button “${button.text}” is not supported by this Telegram layer.`);
      return;
    }
    setButtonBusy(busyId);
    setError("");
    try {
      if (button.type === "reply") {
        applyItems(await telegramJson("/send", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: button.text })
        }));
      } else {
        const messageId = Number(button.messageId || fallbackMessageId || 0);
        if (!messageId || !button.data) throw new Error("Telegram callback_data is missing.");
        const data = await telegramJson("/callback", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId, data: button.data })
        });
        applyItems(data);
        const callbackUrl = safeExternalUrl(data?.answer?.url);
        if (callbackUrl) window.open(callbackUrl, "_blank", "noopener,noreferrer");
        if (data?.answer?.message) setNotice(String(data.answer.message));
      }
    } catch (buttonError) {
      setError(buttonError instanceof Error ? buttonError.message : `Could not press “${button.text}”.`);
    } finally { setButtonBusy(""); }
  };

  const renderKeyboard = (message: TelegramMessage) => {
    const keyboard = message.keyboard;
    if (!keyboard?.rows?.length) return null;
    return <div className={`telegram-keyboard telegram-keyboard-${keyboard.kind}`}>
      {keyboard.rows.map((row, rowIndex) => <div className="telegram-keyboard-row" key={`${message.id}-row-${rowIndex}`}>
        {row.map((button, buttonIndex) => {
          const busyId = `${message.messageId}:${button.type}:${button.text}`;
          return <button
            type="button"
            key={`${message.id}-${rowIndex}-${buttonIndex}-${button.text}`}
            className={`telegram-keyboard-button ${button.type === "url" ? "is-url" : ""}`}
            onClick={() => void pressKeyboardButton(button, message.messageId)}
            disabled={Boolean(buttonBusy) || sending || button.type === "unsupported"}
          >
            <span>{buttonBusy === busyId ? "…" : button.text}</span>
            {button.type === "url" ? <ExternalLink size={13} /> : null}
          </button>;
        })}
      </div>)}
    </div>;
  };

  const renderMedia = (message: TelegramMessage) => {
    const media = message.media;
    if (!media) return null;
    if (media.kind === "photo" && media.url) {
      return <a className="telegram-photo-link" href={media.url} target="_blank" rel="noreferrer">
        <img className="telegram-photo" src={media.url} alt={media.fileName || "Telegram photo"} loading="lazy" />
      </a>;
    }
    if (media.kind === "video" && media.url) {
      return <video className="telegram-video" src={media.url} controls playsInline preload="metadata" />;
    }
    if (media.kind === "file" && media.url) {
      return <a className="telegram-file" href={media.url} target="_blank" rel="noreferrer" download={media.fileName || undefined}>
        <span className="telegram-file-icon"><FileText size={22} /></span>
        <span><strong>{media.fileName || "Telegram file"}</strong><small>{formatBytes(media.size) || media.mimeType || "File"}</small></span>
        <Download size={17} />
      </a>;
    }
    if (media.kind === "location" && Number.isFinite(media.latitude) && Number.isFinite(media.longitude)) {
      const latitude = Number(media.latitude);
      const longitude = Number(media.longitude);
      const links = mapLinks(latitude, longitude);
      return <div className="telegram-location">
        <iframe title={`Telegram location ${latitude}, ${longitude}`} src={links.embed} loading="lazy" />
        <a href={links.open} target="_blank" rel="noreferrer"><MapPin size={15} /><span>{latitude.toFixed(6)}, {longitude.toFixed(6)}</span><ExternalLink size={13} /></a>
      </div>;
    }
    if (media.kind === "link") {
      const url = safeExternalUrl(media.url);
      return <a className={`telegram-link-preview ${url ? "" : "disabled"}`} href={url || undefined} target="_blank" rel="noreferrer" onClick={event => { if (!url) event.preventDefault(); }}>
        <span className="telegram-preview-accent" />
        <span className="telegram-preview-copy">
          {media.siteName ? <small>{media.siteName}</small> : null}
          <strong>{media.title || media.url || "Link"}</strong>
          {media.description ? <span>{media.description}</span> : null}
          {media.url ? <em>{media.url}</em> : null}
        </span>
      </a>;
    }
    return null;
  };

  if (!open) return null;
  return <div className="telegram-overlay" onMouseDown={onClose}>
    <section className="telegram-shell" onMouseDown={event => event.stopPropagation()} aria-label="Telegram Bot in Jazz">
      <header className="telegram-header">
        <div className="telegram-heading"><span className="telegram-logo"><Send size={18} /></span><div><strong>Telegram</strong><small>Live Telegram inside Jazz</small></div></div>
        <div className="telegram-header-actions">
          <button type="button" onClick={() => { void loadStatus(); if (selectedBot) void loadMessages(); }} title="Refresh Telegram"><RefreshCw size={17} className={loading ? "telegram-spin" : ""} /></button>
          <button type="button" onClick={onClose} title="Close Telegram"><X size={19} /></button>
        </div>
      </header>

      <div className="telegram-body">
        <aside className={`telegram-bot-list ${selectedBot ? "has-selection" : ""}`}>
          <div className="telegram-list-title"><span>Bots</span><small>{status?.bot ? "1" : "0"}</small></div>
          {status?.bot ? <button type="button" className={`telegram-bot-item ${selectedBot ? "active" : ""}`} onClick={selectBot}>
            <span className="telegram-bot-avatar">{avatarLetter}</span>
            <span className="telegram-bot-copy"><strong>{botListName}</strong><small>{botUsername}</small></span>
            {configured ? <span className="telegram-online-dot" /> : null}
          </button> : <div className="telegram-empty-bot"><Bot size={22} /><span>No bot configured</span></div>}
          <div className="telegram-connection-card">
            {configured ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <div><strong>{configured ? "Connected" : "Setup required"}</strong><small>{configured ? "Secure MTProto session" : "Telegram credentials missing"}</small></div>
          </div>
        </aside>

        <main className={`telegram-chat ${selectedBot ? "bot-selected" : ""}`}>
          {!selectedBot ? <div className="telegram-select-bot"><span className="telegram-select-icon"><Bot size={30} /></span><strong>Select a Telegram bot</strong><span>Choose {botListName} to open the real conversation.</span></div> : <>
            <div className="telegram-chat-title">
              <button type="button" className="telegram-mobile-back" onClick={() => setSelectedBot(false)} title="Back to bot list"><ChevronLeft size={18} /></button>
              <span className="telegram-bot-avatar large">{avatarLetter}</span>
              <div><strong>{botTitle}</strong><small>{configured ? `${botUsername} · ${live && botStarted ? "live" : "connected"}` : botUsername}</small></div>
              {live && botStarted ? <span className="telegram-live-pill">LIVE</span> : null}
            </div>

            {!configured ? <div className="telegram-setup">
              <span className="telegram-setup-icon"><Send size={26} /></span><h3>Connect {botListName}</h3>
              <p>{status?.message || "Configure a Telegram user session for Jazz, then restart Jazz."}</p>
              <div className="telegram-config-box"><code>services/api/.env</code><span>JAZZ_TELEGRAM_BOT_USERNAME=Karnacam_bot</span><span>JAZZ_TELEGRAM_API_ID=...</span><span>JAZZ_TELEGRAM_API_HASH=...</span><span>JAZZ_TELEGRAM_SESSION=...</span></div>
              <small>Credentials and the Telegram session stay server-side and are never returned to the browser.</small>
            </div> : <>
              <div className="telegram-messages" ref={messagesRef}>
                {!botStarted ? <div className="telegram-prestart"><span className="telegram-bot-avatar hero">{avatarLetter}</span><strong>{botTitle}</strong><span>Press START to send the real /start command.</span></div> : null}
                {botStarted && loading && !messages.length ? <div className="telegram-loading">Loading Telegram history…</div> : null}
                {botStarted && !loading && !sortedMessages.length ? <div className="telegram-no-messages"><MessageCircle size={24} /><strong>Connected</strong><span>Waiting for Telegram messages…</span></div> : null}

                {botStarted ? sortedMessages.map(message => <div className={`telegram-message-row ${message.direction === "out" ? "outgoing" : "incoming"}`} key={message.id}>
                  <div className="telegram-message-stack">
                    <div className={`telegram-message-bubble ${message.media ? `has-media media-${message.media.kind}` : ""}`}>
                      {message.forwarded ? <div className="telegram-forwarded"><small>Forwarded from</small><strong>{message.forwarded.label}</strong></div> : null}
                      {message.direction === "in" && !message.forwarded ? <strong className="telegram-sender">{message.from}</strong> : null}
                      {renderMedia(message)}
                      {message.text ? <div className="telegram-message-text">{message.text}</div> : null}
                      <span className="telegram-message-time">{formatTelegramTime(message.date)}{message.direction === "out" ? <CheckCheck size={13} /> : null}</span>
                    </div>
                    {renderKeyboard(message)}
                  </div>
                </div>) : null}
              </div>

              {!botStarted ? <div className="telegram-start-bar"><button type="button" className="telegram-start-button" onClick={() => void startBot()} disabled={sending}>{sending ? "STARTING…" : "START"}</button></div> : <div className="telegram-composer">
                <input value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="Message" disabled={sending} />
                <button type="button" onClick={() => void sendMessage()} disabled={!draft.trim() || sending} title="Send through Telegram"><Send size={18} /></button>
              </div>}
            </>}
          </>}
        </main>
      </div>

      {error ? <div className="telegram-error"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={() => setError("")}><X size={13} /></button></div> : null}
      {notice ? <div className="telegram-notice"><CheckCircle2 size={15} /><span>{notice}</span></div> : null}
    </section>
  </div>;
}
