import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { telegramBridgePlugin } from "./telegram-bridge";

const apiPort = Number(process.env.JAZZ_API_PORT || 8797);
const require = createRequire(import.meta.url);
const appDir = path.dirname(fileURLToPath(import.meta.url));
const reactDir = path.dirname(require.resolve("react/package.json", { paths: [appDir] }));
const reactDomDir = path.dirname(require.resolve("react-dom/package.json", { paths: [appDir] }));
const telegramEnvDir = path.resolve(appDir, "../../services/api");

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),

    // Telegram is intentionally a popup-only transport. It owns only
    // /telegram-api/* and never touches /api/chat, Jazz scripts, or Ollama.
    telegramBridgePlugin({ mode, envDir: telegramEnvDir })
  ],
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
      // This is the normal Jazz path. Telegram is NOT proxied here.
      "/api": `http://127.0.0.1:${apiPort}`
    }
  }
}));
