import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API_TARGET = process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // The MCP SDK references Node globals in a few places; harmless in the browser.
    global: "globalThis",
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // The web client talks to the real backend: REST API and the MCP endpoint.
      "/api": { target: API_TARGET, changeOrigin: false },
      "/mcp": { target: API_TARGET, changeOrigin: false },
      "/healthz": { target: API_TARGET, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
