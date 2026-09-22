import { Buffer } from "node:buffer";
import { Api, TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { loadEnv, type Plugin } from "vite";

type TelegramBridgeOptions = {
  mode: string;
  envDir: string;
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

type TelegramHistoryItem = {
  id: string;
  messageId: number;
  direction: "in" | "out";
  text: string;
  date: string;
  from: string;
  keyboard?: TelegramKeyboard;
};

function className(value: any) {
  return String(value?.className || value?.constructor?.name || "");
}

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

function parseKeyboard(replyMarkup: any, messageId: number): TelegramKeyboard | undefined {
  if (!replyMarkup || !Array.isArray(replyMarkup.rows)) return undefined;

  const markupName = className(replyMarkup);
  const kind: "reply" | "inline" = /inline/i.test(markupName) ? "inline" : "reply";

  const rows = replyMarkup.rows
    .map((row: any) => {
      const buttons = Array.isArray(row?.buttons) ? row.buttons : [];
      return buttons.map((button: any): TelegramKeyboardButton => {
        const buttonName = className(button);
        const nestedType = button?.type;
        const typeName = className(nestedType);
        const text = String(button?.text || "Button");

        // teleproto layer 229+ stores callback/url details inside button.type.
        // Keep legacy field checks too so older Telegram markup still works.
        const callbackValue = button?.data ?? nestedType?.data;
        const urlValue = button?.url ?? nestedType?.url;
        const callback = /callback/i.test(buttonName) || /callback/i.test(typeName) || Boolean(callbackValue);
        const url = /url/i.test(buttonName) || /url/i.test(typeName) || typeof urlValue === "string";

        if (callback) {
          const data = toBase64(callbackValue);
          return data
            ? { text, type: "callback", data, messageId }
            : { text, type: "unsupported", messageId };
        }

        if (url) {
          const target = String(urlValue || "");
          return target
            ? { text, type: "url", url: target, messageId }
            : { text, type: "unsupported", messageId };
        }

        // Reply-keyboard buttons are sent back to the bot as normal Telegram text.
        if (kind === "reply" || /KeyboardButton/i.test(buttonName)) {
          return { text, type: "reply", messageId };
        }

        return { text, type: "unsupported", messageId };
      });
    })
    .filter((row: TelegramKeyboardButton[]) => row.length > 0);

  return rows.length ? { kind, rows } : undefined;
}

export function telegramBridgePlugin({ mode, envDir }: TelegramBridgeOptions): Plugin {
  const fileEnv = loadEnv(mode, envDir, "");
  const botToken = String(process.env.JAZZ_TELEGRAM_BOT_TOKEN || fileEnv.JAZZ_TELEGRAM_BOT_TOKEN || "").trim();
  const configuredBotUsername = String(process.env.JAZZ_TELEGRAM_BOT_USERNAME || fileEnv.JAZZ_TELEGRAM_BOT_USERNAME || "")
    .trim()
    .replace(/^@/, "");
  const apiId = Number(process.env.JAZZ_TELEGRAM_API_ID || fileEnv.JAZZ_TELEGRAM_API_ID || 0);
  const apiHash = String(process.env.JAZZ_TELEGRAM_API_HASH || fileEnv.JAZZ_TELEGRAM_API_HASH || "").trim();
  const sessionString = String(process.env.JAZZ_TELEGRAM_SESSION || fileEnv.JAZZ_TELEGRAM_SESSION || "").trim();

  let client: TelegramClient | null = null;
  let resolvedBotUsername = configuredBotUsername;
  let botDisplayName = configuredBotUsername || "Telegram Bot";

  const sleep = (ms: number) => new Promise(resolvePromise => setTimeout(resolvePromise, ms));

  const botApi = async (method: string, payload: Record<string, unknown> = {}) => {
    if (!botToken) throw new Error("Telegram bot token is not configured.");
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json() as { ok?: boolean; result?: any; description?: string };
    if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed.`);
    return data.result;
  };

  const resolveBotIdentity = async () => {
    if (resolvedBotUsername) {
      return { username: resolvedBotUsername, firstName: botDisplayName };
    }
    if (!botToken) return null;

    const bot = await botApi("getMe");
    resolvedBotUsername = String(bot?.username || "").replace(/^@/, "");
    botDisplayName = String(bot?.first_name || resolvedBotUsername || "Telegram Bot");
    return resolvedBotUsername
      ? { username: resolvedBotUsername, firstName: botDisplayName }
      : null;
  };

  const clientConfigReady = () => Number.isInteger(apiId) && apiId > 0 && Boolean(apiHash && sessionString);

  const getClient = async () => {
    if (!clientConfigReady()) {
      throw new Error(
        "Telegram user session is not configured. Add JAZZ_TELEGRAM_API_ID, JAZZ_TELEGRAM_API_HASH and JAZZ_TELEGRAM_SESSION to services/api/.env."
      );
    }

    if (!client) {
      client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
        connectionRetries: 5,
        autoReconnect: true
      });
      await client.connect();

      const authorized = await client.isUserAuthorized();
      if (!authorized) {
        await client.disconnect();
        client = null;
        throw new Error(
          "Telegram session is not authorized. Run pnpm --filter @jazz/web telegram:login to create a fresh session."
        );
      }
    }

    return client;
  };

  const getBotUsername = async () => {
    const identity = await resolveBotIdentity();
    if (!identity?.username) {
      throw new Error(
        "Telegram bot username is not configured. Set JAZZ_TELEGRAM_BOT_USERNAME or JAZZ_TELEGRAM_BOT_TOKEN."
      );
    }
    return identity.username;
  };

  const readConversation = async (): Promise<TelegramHistoryItem[]> => {
    const tg = await getClient();
    const username = await getBotUsername();
    const entity = await tg.getEntity(`@${username}`);
    const result: TelegramHistoryItem[] = [];

    for await (const message of tg.iterMessages(entity, { limit: 100 })) {
      const text = String((message as any)?.message || "").trim();
      const messageId = Number((message as any)?.id || 0);
      if (!messageId) continue;

      const outgoing = Boolean((message as any)?.out);
      const keyboard = parseKeyboard((message as any)?.replyMarkup, messageId);
      if (!text && !keyboard) continue;

      result.push({
        id: `tg-${messageId}`,
        messageId,
        direction: outgoing ? "out" : "in",
        text: text || "[Telegram message]",
        date: messageDate((message as any)?.date),
        from: outgoing ? "You" : `@${username}`,
        keyboard
      });
    }

    return result.reverse();
  };

  const sendText = async (text: string) => {
    const tg = await getClient();
    const username = await getBotUsername();
    await tg.sendMessage(`@${username}`, { message: text });
    await sleep(650);
    return readConversation();
  };

  const pressCallback = async (messageId: number, dataBase64: string) => {
    const tg = await getClient();
    const username = await getBotUsername();
    const peer = await tg.getInputEntity(`@${username}`);
    const data = Buffer.from(dataBase64, "base64");

    try {
      await (tg as any).api.messages.getBotCallbackAnswer({
        peer,
        msgId: messageId,
        data
      });
    } catch {
      // Raw invocation fallback keeps callback_data working across teleproto layers.
      await tg.invoke(new Api.messages.GetBotCallbackAnswer({
        peer,
        msgId: messageId,
        data
      }));
    }

    await sleep(650);
    return readConversation();
  };

  const readJson = (req: any) => new Promise<any>((resolvePromise, reject) => {
    let raw = "";
    let rejected = false;

    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      raw += chunk.toString("utf8");
      if (raw.length > 64 * 1024) {
        rejected = true;
        reject(new Error("Request body is too large."));
      }
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

  return {
    name: "jazz-telegram-popup-bridge",
    configureServer(server) {
      server.middlewares.use(async (req: any, res: any, next: () => void) => {
        const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;

        // IMPORTANT: Telegram lives only under /telegram-api/*.
        // Normal Jazz chat continues to use /api/chat and never enters this bridge.
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
              bot: identity ? {
                id: 0,
                username: identity.username,
                firstName: identity.firstName || identity.username
              } : undefined,
              message: configured
                ? "Telegram user session is ready inside the Jazz Telegram popup."
                : "Configure JAZZ_TELEGRAM_API_ID, JAZZ_TELEGRAM_API_HASH, JAZZ_TELEGRAM_SESSION and the bot username."
            });
          }

          if (req.method === "GET" && pathname === "/telegram-api/messages") {
            const items = await readConversation();
            return sendJson(res, 200, { ok: true, items });
          }

          if (req.method === "POST" && pathname === "/telegram-api/start") {
            const items = await sendText("/start");
            return sendJson(res, 200, { ok: true, started: true, items });
          }

          if (req.method === "POST" && pathname === "/telegram-api/send") {
            const body = await readJson(req);
            const text = typeof body.text === "string" ? body.text.trim() : "";
            if (!text) return sendJson(res, 400, { ok: false, error: "Message text is required." });
            if (text.length > 4096) {
              return sendJson(res, 400, { ok: false, error: "Telegram messages are limited to 4096 characters." });
            }
            const items = await sendText(text);
            return sendJson(res, 200, { ok: true, items });
          }

          if (req.method === "POST" && pathname === "/telegram-api/callback") {
            const body = await readJson(req);
            const messageId = Number(body.messageId || 0);
            const data = typeof body.data === "string" ? body.data : "";
            if (!messageId || !data) {
              return sendJson(res, 400, { ok: false, error: "Callback messageId and callback_data are required." });
            }
            const items = await pressCallback(messageId, data);
            return sendJson(res, 200, { ok: true, items });
          }

          return sendJson(res, 404, { ok: false, error: "Telegram endpoint not found." });
        } catch (error) {
          return sendJson(res, 502, {
            ok: false,
            error: error instanceof Error ? error.message : "Telegram request failed."
          });
        }
      });
    }
  };
}
