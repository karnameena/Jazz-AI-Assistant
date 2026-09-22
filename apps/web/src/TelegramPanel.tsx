import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, Bot, CheckCircle2, ChevronLeft, ExternalLink,
  MessageCircle, RefreshCw, Send, X
} from "lucide-react";
import "./telegram.css";

type TelegramStatus = {
  ok: boolean;
  scope?: string;
  configured: boolean;
  tokenConfigured: boolean;
  chatConfigured: boolean;
  clientConfigured?: boolean;
  chatId?: string;
  message?: string;
  bot?: {
    id: number;
    username: string;
    firstName: string;
  };
};

type TelegramKeyboardButton = {
  text: string;
  type: "reply" | "callback" | "url" | "unsupported";
  data?: string;
  url?: string;
  messageId?: number;
};

type TelegramKeyboard = {
  kind: "reply" | "inline";
  rows: TelegramKeyboardButton[][];
};

type TelegramMessage = {
  id: string;
  messageId: number;
  direction: "in" | "out";
  text: string;
  date: string;
  from: string;
  keyboard?: TelegramKeyboard;
};

type TelegramPanelProps = {
  open: boolean;
  onClose: () => void;
};

// Deliberately separate from /api/chat. Everything in this component talks only
// to the Telegram popup bridge, so Telegram commands can never become Jazz commands.
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

function startedStorageKey(username?: string) {
  return username ? `jazz-telegram-started:${username.toLowerCase()}` : "";
}

function hasStartInHistory(items: TelegramMessage[]) {
  return items.some(item => item.direction === "out" && item.text.trim().toLowerCase() === "/start");
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
  const messagesRef = useRef<HTMLDivElement | null>(null);

  // A bot token is useful for getMe, but MTProto conversation itself needs the
  // authorized user session + target username. Do not block the popup on token alone.
  const configured = Boolean(status?.configured && status?.chatConfigured && status?.clientConfigured);
  const botTitle = status?.bot?.firstName || status?.bot?.username || "Telegram Bot";
  const botListName = status?.bot?.username || status?.bot?.firstName || "Telegram Bot";
  const botUsername = status?.bot?.username ? `@${status.bot.username}` : "Bot not connected";
  const botKey = startedStorageKey(status?.bot?.username);

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [messages]
  );

  const syncStartedState = (items: TelegramMessage[]) => {
    if (!status?.bot?.username) return;
    const startedFromHistory = hasStartInHistory(items);
    const startedFromStorage = localStorage.getItem(startedStorageKey(status.bot.username)) === "1";
    if (startedFromHistory || startedFromStorage) {
      setBotStarted(true);
      localStorage.setItem(startedStorageKey(status.bot.username), "1");
    }
  };

  const applyItems = (data: any) => {
    const items = Array.isArray(data?.items) ? data.items as TelegramMessage[] : [];
    setMessages(items);
    syncStartedState(items);
  };

  const loadMessages = async (quiet = false) => {
    if (!configured || !selectedBot) return;
    if (!quiet) setLoading(true);
    try {
      const data = await telegramJson("/messages");
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
    } finally {
      setLoading(false);
    }
  };

  const refreshAfterAction = () => {
    window.setTimeout(() => void loadMessages(true), 700);
    window.setTimeout(() => void loadMessages(true), 1600);
  };

  // Opening Quick Actions -> Telegram Bot always begins at the bot list, matching
  // Telegram's bot picker flow. This state is local to the popup only.
  useEffect(() => {
    if (!open) return;
    setSelectedBot(false);
    setError("");
    void loadStatus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open || !configured || !selectedBot) return;
    void loadMessages();
    const timer = window.setInterval(() => void loadMessages(true), 3000);
    return () => window.clearInterval(timer);
  }, [open, configured, selectedBot]);

  useEffect(() => {
    if (!status?.bot?.username) return;
    setBotStarted(localStorage.getItem(startedStorageKey(status.bot.username)) === "1");
  }, [status?.bot?.username]);

  useEffect(() => {
    if (!open || !selectedBot) return;
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open, selectedBot]);

  const selectBot = () => {
    if (!status?.bot) return;
    setSelectedBot(true);
    const stored = localStorage.getItem(startedStorageKey(status.bot.username)) === "1";
    setBotStarted(stored);
    setError("");
    // The selectedBot effect loads the Telegram conversation. Nothing is sent to Jazz.
  };

  const startBot = async () => {
    if (!configured || sending) return;
    setSending(true);
    setError("");
    try {
      const data = await telegramJson("/start", { method: "POST" });
      applyItems(data);
      setBotStarted(true);
      if (botKey) localStorage.setItem(botKey, "1");
      refreshAfterAction();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start this Telegram bot.");
    } finally {
      setSending(false);
    }
  };

  const sendText = async (text: string, clearDraft = false) => {
    const value = text.trim();
    if (!value || !configured || sending) return;
    setSending(true);
    setError("");
    try {
      const data = await telegramJson("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: value })
      });
      applyItems(data);
      if (clearDraft) setDraft("");
      refreshAfterAction();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send Telegram message.");
    } finally {
      setSending(false);
    }
  };

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text) return;
    await sendText(text, true);
  };

  const pressKeyboardButton = async (button: TelegramKeyboardButton, fallbackMessageId: number) => {
    const busyId = `${fallbackMessageId}:${button.type}:${button.text}`;
    if (buttonBusy) return;

    if (button.type === "url") {
      if (button.url) window.open(button.url, "_blank", "noopener,noreferrer");
      return;
    }

    if (button.type === "unsupported") {
      setError(`Telegram button “${button.text}” is not supported by this bot bridge yet.`);
      return;
    }

    setButtonBusy(busyId);
    setError("");
    try {
      if (button.type === "reply") {
        const data = await telegramJson("/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: button.text })
        });
        applyItems(data);
      } else {
        const messageId = Number(button.messageId || fallbackMessageId || 0);
        if (!messageId || !button.data) throw new Error("Telegram callback_data is missing.");
        const data = await telegramJson("/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId, data: button.data })
        });
        applyItems(data);
      }
      refreshAfterAction();
    } catch (buttonError) {
      setError(buttonError instanceof Error ? buttonError.message : `Could not press “${button.text}”.`);
    } finally {
      setButtonBusy("");
    }
  };

  const renderKeyboard = (message: TelegramMessage) => {
    const keyboard = message.keyboard;
    if (!keyboard?.rows?.length) return null;
    return (
      <div className={`telegram-keyboard telegram-keyboard-${keyboard.kind}`}>
        {keyboard.rows.map((row, rowIndex) => (
          <div className="telegram-keyboard-row" key={`${message.id}-row-${rowIndex}`}>
            {row.map((button, buttonIndex) => {
              const busyId = `${message.messageId}:${button.type}:${button.text}`;
              return (
                <button
                  type="button"
                  key={`${message.id}-${rowIndex}-${buttonIndex}-${button.text}`}
                  className={`telegram-keyboard-button ${button.type === "url" ? "is-url" : ""}`}
                  onClick={() => void pressKeyboardButton(button, message.messageId)}
                  disabled={Boolean(buttonBusy) || sending || button.type === "unsupported"}
                  title={button.type === "callback" ? "Telegram callback_data" : button.type === "reply" ? "Send as Telegram message" : undefined}
                >
                  <span>{buttonBusy === busyId ? "…" : button.text}</span>
                  {button.type === "url" ? <ExternalLink size={13} /> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  if (!open) return null;

  return (
    <div className="telegram-overlay" onMouseDown={onClose}>
      <section className="telegram-shell" onMouseDown={event => event.stopPropagation()} aria-label="Telegram Bot in Jazz">
        <header className="telegram-header">
          <div className="telegram-heading">
            <span className="telegram-logo"><Send size={18} /></span>
            <div><strong>Telegram Bot</strong><small>Telegram-only bot session inside Jazz</small></div>
          </div>
          <div className="telegram-header-actions">
            <button type="button" onClick={() => { void loadStatus(); if (selectedBot) void loadMessages(); }} title="Refresh Telegram"><RefreshCw size={17} className={loading ? "telegram-spin" : ""} /></button>
            <button type="button" onClick={onClose} title="Close Telegram"><X size={19} /></button>
          </div>
        </header>

        <div className="telegram-body">
          <aside className={`telegram-bot-list ${selectedBot ? "has-selection" : ""}`}>
            <div className="telegram-list-title"><span>Bots</span><small>{status?.bot ? "1" : "0"}</small></div>
            {status?.bot ? (
              <button type="button" className={`telegram-bot-item ${selectedBot ? "active" : ""}`} onClick={selectBot}>
                <span className="telegram-bot-avatar"><Bot size={19} /></span>
                <span className="telegram-bot-copy"><strong>🤖 {botListName}</strong><small>{botUsername}</small></span>
                {configured ? <span className="telegram-online-dot" /> : null}
              </button>
            ) : (
              <div className="telegram-empty-bot"><Bot size={22} /><span>No bot configured</span></div>
            )}
            <div className="telegram-connection-card">
              {configured ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              <div><strong>{configured ? "Connected" : "Setup required"}</strong><small>{configured ? "Telegram MTProto session" : "Local bot connection"}</small></div>
            </div>
          </aside>

          <main className={`telegram-chat ${selectedBot ? "bot-selected" : ""}`}>
            {!selectedBot ? (
              <div className="telegram-select-bot">
                <span className="telegram-select-icon"><Bot size={30} /></span>
                <strong>Select a Telegram bot</strong>
                <span>Choose Karnacam_bot to open its Telegram conversation.</span>
              </div>
            ) : (
              <>
                <div className="telegram-chat-title">
                  <button type="button" className="telegram-mobile-back" onClick={() => setSelectedBot(false)} title="Back to bot list"><ChevronLeft size={18} /></button>
                  <span className="telegram-bot-avatar large"><Bot size={21} /></span>
                  <div><strong>{botTitle}</strong><small>{configured ? `${botUsername} · connected` : botUsername}</small></div>
                </div>

                {!configured ? (
                  <div className="telegram-setup">
                    <span className="telegram-setup-icon"><Send size={26} /></span>
                    <h3>Connect Karnacam_bot</h3>
                    <p>{status?.message || "Configure a Telegram user session for Jazz, then restart the web app."}</p>
                    <div className="telegram-config-box">
                      <code>services/api/.env</code>
                      <span>JAZZ_TELEGRAM_BOT_USERNAME=Karnacam_bot</span>
                      <span>JAZZ_TELEGRAM_BOT_TOKEN=...</span>
                      <span>JAZZ_TELEGRAM_API_ID=...</span>
                      <span>JAZZ_TELEGRAM_API_HASH=...</span>
                      <span>JAZZ_TELEGRAM_SESSION=...</span>
                    </div>
                    <small>This connection is used only by the Telegram popup. Jazz chat, scripts and Ollama stay on their existing route.</small>
                  </div>
                ) : (
                  <>
                    <div className="telegram-messages" ref={messagesRef}>
                      {loading && !messages.length ? <div className="telegram-loading">Loading Telegram…</div> : null}

                      {!loading && !botStarted && !sortedMessages.length ? (
                        <div className="telegram-prestart">
                          <span className="telegram-select-icon"><Bot size={28} /></span>
                          <strong>{botTitle}</strong>
                          <span>Press START to send /start and load the bot menu.</span>
                        </div>
                      ) : null}

                      {!loading && botStarted && !sortedMessages.length ? (
                        <div className="telegram-no-messages"><MessageCircle size={24} /><strong>Bot started</strong><span>Waiting for Telegram messages…</span></div>
                      ) : null}

                      {sortedMessages.map(message => (
                        <div key={message.id} className={`telegram-message-row ${message.direction === "out" ? "outgoing" : "incoming"}`}>
                          <div className="telegram-message-stack">
                            <div className="telegram-message-bubble">
                              {message.direction === "in" && <small className="telegram-sender">{message.from}</small>}
                              <div className="telegram-message-text">{message.text}</div>
                              <small className="telegram-message-time">{formatTelegramTime(message.date)}</small>
                            </div>
                            {message.direction === "in" ? renderKeyboard(message) : null}
                          </div>
                        </div>
                      ))}
                    </div>

                    {!botStarted ? (
                      <div className="telegram-start-bar">
                        <button type="button" className="telegram-start-button" onClick={() => void startBot()} disabled={sending || loading}>
                          {sending ? "STARTING…" : "START"}
                        </button>
                      </div>
                    ) : (
                      <div className="telegram-composer">
                        <input
                          value={draft}
                          onChange={event => setDraft(event.target.value)}
                          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }}
                          placeholder={`Message ${botTitle}…`}
                          disabled={sending || Boolean(buttonBusy)}
                        />
                        <button type="button" onClick={() => void sendMessage()} disabled={!draft.trim() || sending || Boolean(buttonBusy)} title="Send Telegram message">
                          <Send size={18} />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {error && <div className="telegram-error"><AlertCircle size={15} />{error}</div>}
          </main>
        </div>
      </section>
    </div>
  );
}
