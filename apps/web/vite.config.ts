import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
	optimizeDeps: {
		// Same regression bites the dep pre-bundling pass (used for
		// node_modules like class-variance-authority, radix-ui) — without
		// this override, `bun run dev` prints ~1700 destructuring errors
		// on cold start.
		esbuildOptions: {
			supported: { destructuring: true },
		},
	},
});
