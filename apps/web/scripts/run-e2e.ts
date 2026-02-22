#!/usr/bin/env bun
/**
 * E2E Test Runner
 *
 * This script:
 * 1. Loads .env.e2e for test credentials (AI keys, etc.)
 * 2. Creates and seeds E2E database
 * 3. Starts dev server on dedicated port (17025) with PLAYWRIGHT=1
 * 4. Runs E2E tests
 * 5. Cleans up
 *
 * Usage:
 *   bun run test:e2e
 */

import { spawn, type Subprocess } from "bun";
import { existsSync, unlinkSync, rmSync, readFileSync } from "fs";
import { resolve } from "path";

const E2E_PORT = "17025";
const E2E_DB_FILE = "database/lyre.e2e.db";
const E2E_DIST_DIR = ".next-e2e";

let serverProcess: Subprocess | null = null;

/**
 * Load .env.e2e file and return key-value pairs.
 * Lines starting with # are ignored. Format: KEY=VALUE or KEY="VALUE".
 */
function loadEnvFile(filePath: string): Record<string, string> {
  const absPath = resolve(filePath);
  if (!existsSync(absPath)) return {};

  const content = readFileSync(absPath, "utf-8");
  const env: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
}

async function waitForServer(maxAttempts = 60): Promise<boolean> {
  const baseUrl = `http://localhost:${E2E_PORT}`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${baseUrl}/api/live`);
      if (response.ok) return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

async function cleanup() {
  console.log("\n  Cleaning up...");

  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (existsSync(E2E_DB_FILE)) {
    unlinkSync(E2E_DB_FILE);
    console.log(`   Removed ${E2E_DB_FILE}`);
  }

  if (existsSync(E2E_DIST_DIR)) {
    rmSync(E2E_DIST_DIR, { recursive: true, force: true });
    console.log(`   Removed ${E2E_DIST_DIR}`);
  }
}

async function main() {
  console.log("E2E Test Runner\n");

  // Load .env.e2e for test credentials (AI keys, etc.)
  const e2eEnv = loadEnvFile(".env.e2e");
  const e2eEnvKeys = Object.keys(e2eEnv);
  if (e2eEnvKeys.length > 0) {
    console.log(`Loaded ${e2eEnvKeys.length} vars from .env.e2e: ${e2eEnvKeys.join(", ")}`);
  } else {
    console.log("No .env.e2e found — AI integration tests will be skipped");
  }

  // Cleanup any existing E2E artifacts
  if (existsSync(E2E_DB_FILE)) {
    unlinkSync(E2E_DB_FILE);
  }

  // Step 1: Start dev server with PLAYWRIGHT=1
  console.log(`\nStarting E2E server on port ${E2E_PORT}...`);
  serverProcess = spawn(["bun", "run", "next", "dev", "-p", E2E_PORT], {
    env: {
      ...process.env,
      ...e2eEnv,
      LYRE_DB: E2E_DB_FILE,
      NEXT_DIST_DIR: E2E_DIST_DIR,
      PLAYWRIGHT: "1",
      // Force mock ASR provider in E2E (unset real API key)
      DASHSCOPE_API_KEY: "",
      // Skip archiving raw ASR results to OSS in E2E
      SKIP_OSS_ARCHIVE: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const ready = await waitForServer();
  if (!ready) {
    console.error("Failed to start E2E server");
    await cleanup();
    process.exit(1);
  }
  console.log("E2E server ready!\n");

  // Step 2: Run E2E tests
  console.log("Running E2E tests...\n");
  const testResult = Bun.spawnSync(
    ["bun", "test", "src/__tests__/e2e", "--timeout", "30000"],
    {
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        ...e2eEnv,
        E2E_PORT,
      },
    }
  );

  // Step 3: Cleanup
  await cleanup();

  console.log(
    "\n" +
      (testResult.exitCode === 0
        ? "E2E tests passed!"
        : "E2E tests failed!")
  );
  process.exit(testResult.exitCode ?? 1);
}

// Handle process signals
process.on("SIGINT", async () => {
  await cleanup();
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(1);
});

main();
