import { Buffer } from "node:buffer";
import { basename } from "node:path";
import { Api, TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { loadEnv, type Plugin } from "vite";

type TelegramBridgeOptions = { mode: string; envDir: string };
type TelegramKeyboardButton = { text: string; type: "reply" | "callback" | "url" | "unsupported"; data?: string; url?: string; messageId?: number };
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
type TelegramForward = { label: string; date?: string };
type TelegramHistoryItem = {
  id: string;
  messageId: number;
  direction: "in" | "out";
  text: string;
  date: string;
  from: string;
  keyboard?: TelegramKeyboard;
  media?: TelegramMedia;
  forwarded?: TelegramForward;
};

function className(value: any) { return String(value?.className || value?.constructor?.name || ""); }
function toBase64(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return Buffer.from(value, "utf8").toString("base64");
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (Array.isArray(value)) return Buffer.from(value).toString("base64");
  return "";
}
function messageDate(value: unknown) {
  let numeric = Number(value || 0);
  if (!numeric) numeric = Date.now();
  if (numeric < 1_000_000_000_000) numeric *= 1000;
  return new Date(numeric).toISOString();
}
function safeFileName(value: unknown, fallback: string) {
  const name = basename(String(value || fallback)).replace(/[\r\n"<>:|?*]/g, "_").trim();
  return name || fallback;
}
function documentFileName(document: any, fallback: string) {
  for (const attribute of Array.isArray(document?.attributes) ? document.attributes : []) {
    if (/Filename/i.test(className(attribute)) && attribute?.fileName) return safeFileName(attribute.fileName, fallback);
  }
  return fallback;
}
function parseKeyboard(replyMarkup: any, messageId: number): TelegramKeyboard | undefined {
  if (!replyMarkup || !Array.isArray(replyMarkup.rows)) return undefined;
  const markupName = className(replyMarkup);
  const kind: "reply" | "inline" = /inline/i.test(markupName) ? "inline" : "reply";
  const rows = replyMarkup.rows.map((row: any) => {
    const buttons = Array.isArray(row?.buttons) ? row.buttons : [];
    return buttons.map((button: any): TelegramKeyboardButton => {
      const buttonName = className(button);
      const nestedType = button?.type;
      const typeName = className(nestedType);
      const text = String(button?.text || "Button");
      const callbackValue = button?.data ?? nestedType?.data;
      const urlValue = button?.url ?? nestedType?.url;
      const callback = /callback/i.test(buttonName) || /callback/i.test(typeName) || Boolean(callbackValue);
      const url = /url|webview/i.test(buttonName) || /url|webview/i.test(typeName) || typeof urlValue === "string";
      if (callback) {
        const data = toBase64(callbackValue);
        return data ? { text, type: "callback", data, messageId } : { text, type: "unsupported", messageId };
      }
      if (url) {
        const target = String(urlValue || "");
        return target ? { text, type: "url", url: target, messageId } : { text, type: "unsupported", messageId };
      }
      if (kind === "reply" || /KeyboardButton/i.test(buttonName)) return { text, type: "reply", messageId };
      return { text, type: "unsupported", messageId };
    });
  }).filter((row: TelegramKeyboardButton[]) => row.length > 0);
  return rows.length ? { kind, rows } : undefined;
}
function parseForward(message: any): TelegramForward | undefined {
  const fwd = message?.fwdFrom;
  if (!fwd) return undefined;
  const label = String(fwd?.fromName || fwd?.postAuthor || fwd?.savedFromPeer?.username || "Forwarded message").trim();
  return { label, date: fwd?.date ? messageDate(fwd.date) : undefined };
}
function parseMedia(message: any, messageId: number): TelegramMedia | undefined {
  const media = message?.media;
  if (!media) return undefined;
  const mediaName = className(media);
  const geo = media?.geo || message?.geo;
  if (/Geo/i.test(mediaName) || geo?.lat !== undefined) {
    const latitude = Number(geo?.lat);
    const longitude = Number(geo?.long ?? geo?.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) return { kind: "location", latitude, longitude };
  }
  const webpage = media?.webpage || message?.webPage || message?.webpage;
  if (/WebPage/i.test(mediaName) || webpage) {
    const url = String(webpage?.url || webpage?.displayUrl || "").trim();
    return {
      kind: "link",
      url,
      title: String(webpage?.title || webpage?.siteName || url || "Link").trim(),
      description: String(webpage?.description || "").trim(),
      siteName: String(webpage?.siteName || "").trim()
    };
  }
  const document = message?.document || media?.document;
  if (document) {
    const mimeType = String(document?.mimeType || "application/octet-stream");
    const attributes = Array.isArray(document?.attributes) ? document.attributes : [];
    const isVideo = mimeType.startsWith("video/") || attributes.some((attr: any) => /Video/i.test(className(attr)));
    const isImage = mimeType.startsWith("image/") || attributes.some((attr: any) => /Sticker/i.test(className(attr)));
    const fallback = isVideo ? `video-${messageId}.mp4` : isImage ? `image-${messageId}.jpg` : `file-${messageId}`;
    return {
      kind: isVideo ? "video" : isImage ? "photo" : "file",
      url: `/telegram-api/media/${messageId}`,
      mimeType,
      fileName: documentFileName(document, fallback),
      size: Number(document?.size || 0) || undefined
    };
  }
  const photo = message?.photo || media?.photo;
  if (photo || /Photo/i.test(mediaName)) {
    return { kind: "photo", url: `/telegram-api/media/${messageId}`, mimeType: "image/jpeg", fileName: `photo-${messageId}.jpg` };
  }
  return undefined;
}

export function telegramBridgePlugin({ mode, envDir }: TelegramBridgeOptions): Plugin {
  const fileEnv = loadEnv(mode, envDir, "");
  const botToken = String(process.env.JAZZ_TELEGRAM_BOT_TOKEN || fileEnv.JAZZ_TELEGRAM_BOT_TOKEN || "").trim();
  const configuredBotUsername = String(process.env.JAZZ_TELEGRAM_BOT_USERNAME || fileEnv.JAZZ_TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");
  const apiId = Number(process.env.JAZZ_TELEGRAM_API_ID || fileEnv.JAZZ_TELEGRAM_API_ID || 0);
  const apiHash = String(process.env.JAZZ_TELEGRAM_API_HASH || fileEnv.JAZZ_TELEGRAM_API_HASH || "").trim();
  const sessionString = String(process.env.JAZZ_TELEGRAM_SESSION || fileEnv.JAZZ_TELEGRAM_SESSION || "").trim();
  const historyLimit = Math.max(20, Math.min(300, Number(process.env.JAZZ_TELEGRAM_HISTORY_LIMIT || fileEnv.JAZZ_TELEGRAM_HISTORY_LIMIT || 150)));

  let client: TelegramClient | null = null;
  let resolvedBotUsername = configuredBotUsername;
  let botDisplayName = configuredBotUsername || "Telegram Bot";
  let botId = 0;
  const subscribers = new Set<any>();
  let realtimeTimer: ReturnType<typeof setInterval> | null = null;
  let realtimeBusy = false;
  let lastRealtimeSignature = "";

  const sleep = (ms: number) => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
  const botApi = async (method: string, payload: Record<string, unknown> = {}) => {
    if (!botToken) throw new Error("Telegram bot token is not configured.");
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    const data = await response.json() as { ok?: boolean; result?: any; description?: string };
    if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed.`);
    return data.result;
  };

  const resolveBotIdentity = async () => {
    if (botToken) {
      try {
        const bot = await botApi("getMe");
        botId = Number(bot?.id || 0);
        const tokenUsername = String(bot?.username || "").replace(/^@/, "");
        if (!resolvedBotUsername && tokenUsername) resolvedBotUsername = tokenUsername;
        botDisplayName = String(bot?.first_name || botDisplayName || resolvedBotUsername || "Telegram Bot");
      } catch {
        // A configured username + user session is enough for MTProto chat.
      }
    }
    return resolvedBotUsername ? { id: botId, username: resolvedBotUsername, firstName: botDisplayName } : null;
  };

  const clientConfigReady = () => Number.isInteger(apiId) && apiId > 0 && Boolean(apiHash && sessionString);
  const getClient = async () => {
    if (!clientConfigReady()) throw new Error("Telegram user session is not configured. Add JAZZ_TELEGRAM_API_ID, JAZZ_TELEGRAM_API_HASH and JAZZ_TELEGRAM_SESSION to services/api/.env.");
    if (!client) {
      client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, { connectionRetries: 5, autoReconnect: true });
      await client.connect();
      if (!await client.isUserAuthorized()) {
        await client.disconnect();
        client = null;
        throw new Error("Telegram session is not authorized. Run pnpm --filter @jazz/web telegram:login to create a fresh session.");
      }
    }
    return client;
  };
  const getBotUsername = async () => {
    const identity = await resolveBotIdentity();
    if (!identity?.username) throw new Error("Telegram bot username is not configured. Set JAZZ_TELEGRAM_BOT_USERNAME or JAZZ_TELEGRAM_BOT_TOKEN.");
    return identity.username;
  };

  const readConversation = async (limit = historyLimit): Promise<TelegramHistoryItem[]> => {
    const tg = await getClient();
    const username = await getBotUsername();
    const entity = await tg.getEntity(`@${username}`);
    const result: TelegramHistoryItem[] = [];
    for await (const message of tg.iterMessages(entity, { limit })) {
      const raw = message as any;
      const messageId = Number(raw?.id || 0);
      if (!messageId) continue;
      const text = String(raw?.message || "").trim();
      const keyboard = parseKeyboard(raw?.replyMarkup, messageId);
      const media = parseMedia(raw, messageId);
      if (!text && !keyboard && !media) continue;
      const outgoing = Boolean(raw?.out);
      const sender = raw?.sender;
      const senderLabel = outgoing ? "You" : String(sender?.firstName || sender?.title || (sender?.username ? `@${sender.username}` : "") || `@${username}`);
      result.push({
        id: `tg-${messageId}`,
        messageId,
        direction: outgoing ? "out" : "in",
        text,
        date: messageDate(raw?.date),
        from: senderLabel,
        keyboard,
        media,
        forwarded: parseForward(raw)
      });
    }
    return result.reverse();
  };

  const sendText = async (text: string) => {
    const tg = await getClient();
    const username = await getBotUsername();
    await tg.sendMessage(`@${username}`, { message: text });
    await sleep(300);
    return readConversation();
  };

  const pressCallback = async (messageId: number, dataBase64: string) => {
    const tg = await getClient();
    const username = await getBotUsername();
    const peer = await tg.getInputEntity(`@${username}`);
    const data = Buffer.from(dataBase64, "base64");
    let answer: any;
    try {
      answer = await (tg as any).api.messages.getBotCallbackAnswer({ peer, msgId: messageId, data });
    } catch {
      answer = await tg.invoke(new Api.messages.GetBotCallbackAnswer({ peer, msgId: messageId, data }));
    }
    await sleep(300);
    return {
      items: await readConversation(),
      answer: { message: String(answer?.message || ""), url: String(answer?.url || ""), alert: Boolean(answer?.alert) }
    };
  };

  const getMessageById = async (messageId: number) => {
    const tg = await getClient();
    const username = await getBotUsername();
    const entity = await tg.getEntity(`@${username}`);
    const list = await (tg as any).getMessages(entity, { ids: [messageId] });
    return Array.isArray(list) ? list[0] : list?.[0];
  };

  const downloadMessageMedia = async (messageId: number) => {
    const tg = await getClient();
    const message = await getMessageById(messageId);
    if (!message?.media) throw new Error("Telegram media was not found.");
    const media = parseMedia(message, messageId);
    if (!media || !["photo", "video", "file"].includes(media.kind)) throw new Error("This Telegram message does not contain downloadable media.");
    const downloaded = await (tg as any).downloadMedia(message, {});
    const buffer = Buffer.isBuffer(downloaded) ? downloaded : downloaded instanceof Uint8Array ? Buffer.from(downloaded) : null;
    if (!buffer?.length) throw new Error("Telegram returned no media bytes.");
    return {
      buffer,
      mimeType: media.mimeType || (media.kind === "photo" ? "image/jpeg" : "application/octet-stream"),
      fileName: safeFileName(media.fileName, `${media.kind}-${messageId}`)
    };
  };

  const readJson = (req: any) => new Promise<any>((resolvePromise, reject) => {
    let raw = "";
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      raw += chunk.toString("utf8");
      if (raw.length > 64 * 1024) { rejected = true; reject(new Error("Request body is too large.")); }
    });
    req.on("end", () => {
      if (rejected) return;
      try { resolvePromise(JSON.parse(raw || "{}")); }
      catch { reject(new Error("Invalid JSON request.")); }
    });
  });

  const sendJson = (res: any, status: number, data: unknown) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(data));
  };
  const sendEvent = (res: any, event: string, data: unknown) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const conversationSignature = (items: TelegramHistoryItem[]) => JSON.stringify(items.map(item => ({
    id: item.id, text: item.text, date: item.date, keyboard: item.keyboard, media: item.media, forwarded: item.forwarded
  })));

  const broadcastConversation = async (force = false) => {
    if (!subscribers.size || realtimeBusy) return;
    realtimeBusy = true;
    try {
      const items = await readConversation();
      const signature = conversationSignature(items);
      if (force || signature !== lastRealtimeSignature) {
        lastRealtimeSignature = signature;
        for (const res of subscribers) sendEvent(res, "messages", { ok: true, items });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Telegram realtime update failed.";
      for (const res of subscribers) sendEvent(res, "telegram-error", { message });
    } finally {
      realtimeBusy = false;
    }
  };
  const ensureRealtime = () => {
    if (realtimeTimer || !subscribers.size) return;
    realtimeTimer = setInterval(() => void broadcastConversation(false), 1200);
    void broadcastConversation(true);
  };
  const stopRealtimeIfIdle = () => {
    if (subscribers.size || !realtimeTimer) return;
    clearInterval(realtimeTimer);
    realtimeTimer = null;
    lastRealtimeSignature = "";
  };

  return {
    name: "jazz-telegram-popup-bridge",
    configureServer(server) {
      server.httpServer?.once("close", () => {
        if (realtimeTimer) clearInterval(realtimeTimer);
        realtimeTimer = null;
        for (const res of subscribers) { try { res.end(); } catch {} }
        subscribers.clear();
        void client?.disconnect().catch(() => undefined);
      });

      server.middlewares.use(async (req: any, res: any, next: () => void) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const pathname = url.pathname;
        if (!pathname.startsWith("/telegram-api/")) return next();

        try {
          if (req.method === "GET" && pathname === "/telegram-api/status") {
            const identity = await resolveBotIdentity().catch(() => null);
            const configured = clientConfigReady() && Boolean(identity?.username);
            return sendJson(res, 200, {
              ok: true,
              scope: "telegram-popup-only",
              configured,
              tokenConfigured: Boolean(botToken),
              chatConfigured: Boolean(identity?.username),
              clientConfigured: clientConfigReady(),
              realtime: true,
              historyLimit,
              bot: identity || undefined,
              message: configured ? "Telegram user session is ready inside the Jazz Telegram popup." : "Configure JAZZ_TELEGRAM_API_ID, JAZZ_TELEGRAM_API_HASH, JAZZ_TELEGRAM_SESSION and the bot username."
            });
          }

          if (req.method === "GET" && pathname === "/telegram-api/events") {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("Connection", "keep-alive");
            res.setHeader("X-Accel-Buffering", "no");
            res.flushHeaders?.();
            subscribers.add(res);
            sendEvent(res, "ready", { ok: true });
            ensureRealtime();
            const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 15000);
            req.on("close", () => {
              clearInterval(heartbeat);
              subscribers.delete(res);
              stopRealtimeIfIdle();
            });
            return;
          }

          if (req.method === "GET" && pathname === "/telegram-api/messages") {
            const requested = Number(url.searchParams.get("limit") || historyLimit);
            const limit = Math.max(20, Math.min(300, Number.isFinite(requested) ? requested : historyLimit));
            return sendJson(res, 200, { ok: true, items: await readConversation(limit) });
          }

          const mediaMatch = pathname.match(/^\/telegram-api\/media\/(\d+)$/);
          if (req.method === "GET" && mediaMatch) {
            const media = await downloadMessageMedia(Number(mediaMatch[1]));
            res.statusCode = 200;
            res.setHeader("Content-Type", media.mimeType);
            res.setHeader("Content-Length", String(media.buffer.length));
            res.setHeader("Content-Disposition", `inline; filename="${media.fileName}"`);
            res.setHeader("Cache-Control", "private, max-age=60");
            res.end(media.buffer);
            return;
          }

          if (req.method === "POST" && pathname === "/telegram-api/start") {
            const items = await sendText("/start");
            void broadcastConversation(true);
            return sendJson(res, 200, { ok: true, started: true, items });
          }

          if (req.method === "POST" && pathname === "/telegram-api/send") {
            const body = await readJson(req);
            const text = typeof body.text === "string" ? body.text.trim() : "";
            if (!text) return sendJson(res, 400, { ok: false, error: "Message text is required." });
            if (text.length > 4096) return sendJson(res, 400, { ok: false, error: "Telegram messages are limited to 4096 characters." });
            const items = await sendText(text);
            void broadcastConversation(true);
            return sendJson(res, 200, { ok: true, items });
          }

          if (req.method === "POST" && pathname === "/telegram-api/callback") {
            const body = await readJson(req);
            const messageId = Number(body.messageId || 0);
            const data = typeof body.data === "string" ? body.data : "";
            if (!messageId || !data) return sendJson(res, 400, { ok: false, error: "Callback messageId and callback_data are required." });
            const result = await pressCallback(messageId, data);
            void broadcastConversation(true);
            return sendJson(res, 200, { ok: true, ...result });
          }

          return sendJson(res, 404, { ok: false, error: "Telegram endpoint not found." });
        } catch (error) {
          return sendJson(res, 502, { ok: false, error: error instanceof Error ? error.message : "Telegram request failed." });
        }
      });
    }
  };
}
