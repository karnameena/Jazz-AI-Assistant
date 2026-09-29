import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5190,
    proxy: {
      "/api": {
        target: process.env.LOST_MODE_API_URL || "http://127.0.0.1:8890",
        changeOrigin: true
      }
    }
  }
});
