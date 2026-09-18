import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = Number(process.env.JAZZ_API_PORT || 8797);

export default defineConfig({
  plugins: [react()],
  cacheDir: "node_modules/.vite-jazz",
  resolve: {
    dedupe: ["react", "react-dom"],
    preserveSymlinks: false,
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-dom/client", "lucide-react"],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
});
