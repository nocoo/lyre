import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Prevent Vite from obscuring Rust errors
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  // Use relative paths so Tauri custom-protocol can load assets
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Tauri uses Chromium on macOS, target modern browsers
    target: "safari14",
  },
});
