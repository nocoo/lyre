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
    allowedHosts: ["lyre.dev.hexly.ai"],
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
  esbuild: {
    // esbuild 0.28.x regressed and flags destructuring as needing
    // downlevel for our browser targets even though all of them
    // (chrome87+, es2020, firefox78, safari14, edge88) support it
    // natively. Pin support explicitly until upstream restores defaults.
    supported: { destructuring: true },
  },
});
