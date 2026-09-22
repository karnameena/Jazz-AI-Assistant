import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = Number(process.env.JAZZ_API_PORT || 8797);
const require = createRequire(import.meta.url);
const appDir = path.dirname(fileURLToPath(import.meta.url));
const reactDir = path.dirname(require.resolve("react/package.json", { paths: [appDir] }));
const reactDomDir = path.dirname(require.resolve("react-dom/package.json", { paths: [appDir] }));
const telegramEnvDir = path.resolve(appDir, "../../services/api");

type TelegramHistoryItem = {
  id: string;
  direction: "in" | "out";
  text: string;
  date: string;
  from: string;
};

function telegramBridgePlugin(mode: string) {
  const fileEnv = loadEnv(mode, telegramEnvDir, "");
  const botToken = String(process.env.JAZZ_TELEGRAM_BOT_TOKEN || fileEnv.JAZZ_TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(process.env.JAZZ_TELEGRAM_CHAT_ID || fileEnv.JAZZ_TELEGRAM_CHAT_ID || "").trim();
  const history: TelegramHistoryItem[] = [];
  let lastUpdateId = 0;

  const telegramApi = async (method: string, payload: Record<string, unknown> = {}) => {
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

  const chatMatches = (chat: any) => {
    if (!chat || !chatId) return false;
    if (String(chat.id) === chatId) return true;
    const configuredUsername = chatId.replace(/^@/, "").toLowerCase();
    return Boolean(chat.username && String(chat.username).toLowerCase() === configuredUsername);
  };

  const pushHistory = (item: TelegramHistoryItem) => {
    if (history.some(existing => existing.id === item.id)) return;
    history.push(item);
    if (history.length > 150) history.splice(0, history.length - 150);
  };

  const pollUpdates = async () => {
    if (!botToken || !chatId) return;
    const payload: Record<string, unknown> = { timeout: 0, limit: 100, allowed_updates: ["message"] };
    if (lastUpdateId > 0) payload.offset = lastUpdateId + 1;
    const updates = await telegramApi("getUpdates", payload);
    for (const update of Array.isArray(updates) ? updates : []) {
      const updateId = Number(update?.update_id || 0);
      if (updateId > lastUpdateId) lastUpdateId = updateId;
      const message = update?.message;
      if (!message || !chatMatches(message.chat)) continue;
      const text = typeof message.text === "string" ? message.text : typeof message.caption === "string" ? message.caption : "[Unsupported Telegram message]";
      const sender = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || message.from?.username || "Telegram";
      pushHistory({
        id: `in-${message.message_id}`,
        direction: "in",
        text,
        date: new Date(Number(message.date || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        from: sender
      });
    }
  };

  const readJson = (req: any) => new Promise<any>((resolvePromise, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
      if (raw.length > 64 * 1024) reject(new Error("Request body is too large."));
    });
    req.on("end", () => {
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

  const maskedChatId = () => {
    if (!chatId) return "";
    if (chatId.startsWith("@")) return chatId;
    if (chatId.length <= 4) return "••••";
    return `${"•".repeat(Math.min(8, chatId.length - 4))}${chatId.slice(-4)}`;
  };

  return {
    name: "jazz-telegram-bridge",
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: () => void) => {
        const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
        if (!pathname.startsWith("/telegram-api/")) return next();

        try {
          if (req.method === "GET" && pathname === "/telegram-api/status") {
            if (!botToken) {
              return sendJson(res, 200, {
                ok: true,
                configured: false,
                tokenConfigured: false,
                chatConfigured: Boolean(chatId),
                message: "Add JAZZ_TELEGRAM_BOT_TOKEN to services/api/.env and restart Jazz."
              });
            }
            const bot = await telegramApi("getMe");
            return sendJson(res, 200, {
              ok: true,
              configured: Boolean(chatId),
              tokenConfigured: true,
              chatConfigured: Boolean(chatId),
              chatId: maskedChatId(),
              bot: {
                id: bot.id,
                username: bot.username || "",
                firstName: bot.first_name || "Telegram Bot"
              },
              message: chatId ? "Telegram is ready inside Jazz." : "Bot token is valid. Add JAZZ_TELEGRAM_CHAT_ID to services/api/.env."
            });
          }

          if (req.method === "GET" && pathname === "/telegram-api/messages") {
            if (!botToken || !chatId) return sendJson(res, 503, { ok: false, error: "Telegram bot token and chat ID are required." });
            await pollUpdates();
            return sendJson(res, 200, { ok: true, items: history.slice(-100) });
          }

          if (req.method === "POST" && pathname === "/telegram-api/send") {
            if (!botToken || !chatId) return sendJson(res, 503, { ok: false, error: "Telegram bot token and chat ID are required." });
            const body = await readJson(req);
            const text = typeof body.text === "string" ? body.text.trim() : "";
            if (!text) return sendJson(res, 400, { ok: false, error: "Message text is required." });
            if (text.length > 4096) return sendJson(res, 400, { ok: false, error: "Telegram messages are limited to 4096 characters." });

            const sent = await telegramApi("sendMessage", { chat_id: chatId, text });
            const item: TelegramHistoryItem = {
              id: `out-${sent.message_id}`,
              direction: "out",
              text,
              date: new Date(Number(sent.date || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
              from: "Jazz"
            };
            pushHistory(item);
            return sendJson(res, 200, { ok: true, item });
          }

          return sendJson(res, 404, { ok: false, error: "Telegram endpoint not found." });
        } catch (error) {
          return sendJson(res, 502, { ok: false, error: error instanceof Error ? error.message : "Telegram request failed." });
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), telegramBridgePlugin(mode)],
  cacheDir: "node_modules/.vite-jazz",
  resolve: {
    dedupe: ["react", "react-dom"],
    preserveSymlinks: false,
    alias: [
      { find: /^react$/, replacement: path.join(reactDir, "index.js") },
      { find: /^react\/jsx-runtime$/, replacement: path.join(reactDir, "jsx-runtime.js") },
      { find: /^react\/jsx-dev-runtime$/, replacement: path.join(reactDir, "jsx-dev-runtime.js") },
      { find: /^react-dom$/, replacement: path.join(reactDomDir, "index.js") },
      { find: /^react-dom\/client$/, replacement: path.join(reactDomDir, "client.js") }
    ]
  },
  optimizeDeps: {
    force: true,
    include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "lucide-react"]
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`
    }
  }
}));
