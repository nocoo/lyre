import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["node_modules/**"],
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
      skipFull: true,
      include: ["src/lib/**/*.ts"],
      exclude: [
        "node_modules/",
        "**/*.test.ts",
        "**/*.config.*",
        "**/*.d.ts",
        "src/__tests__/",
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 75,
        statements: 85,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
