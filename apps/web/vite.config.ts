import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Vite SPA for Lyre. Build output is consumed by apps/api Worker via [assets].
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 7016,
    proxy: {
      // During `vite dev`, forward /api/* to the local Worker on :7017.
      "/api": {
        target: "http://localhost:7017",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../api/static",
    emptyOutDir: true,
    sourcemap: true,
  },
});
