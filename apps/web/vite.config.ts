import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = Number(process.env.JAZZ_API_PORT || 8797);
const require = createRequire(import.meta.url);
const appDir = path.dirname(fileURLToPath(import.meta.url));
const reactDir = path.dirname(require.resolve("react/package.json", { paths: [appDir] }));
const reactDomDir = path.dirname(require.resolve("react-dom/package.json", { paths: [appDir] }));

export default defineConfig({
  plugins: [react()],
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
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`
    }
  }
});
