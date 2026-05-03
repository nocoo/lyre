import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/bdd",
  globalSetup: "./e2e/bdd/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: "html",
  use: {
    baseURL: "http://localhost:27016",
    trace: "on-first-retry",
    headless: true,
  },
  webServer: {
    command: "npx wrangler dev --env test --port 27016",
    cwd: "apps/api",
    port: 27016,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
