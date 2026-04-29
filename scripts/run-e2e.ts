/**
 * L2: API E2E test runner with full server lifecycle.
 *
 * Steps:
 *   1. Spawn `wrangler dev --env test` on port 7017
 *   2. Wait for server ready (poll /api/live)
 *   3. Run `bun test e2e/api/`
 *   4. Kill server
 *   5. Exit with test exit code
 *
 * The test environment uses E2E_SKIP_AUTH=true (in wrangler.toml [env.test])
 * which synthesizes a stable test user, and a separate test D1 database.
 *
 * Usage:
 *   bun run scripts/run-e2e.ts
 */

import { resolve } from "node:path";
import type { Subprocess } from "bun";

const ROOT = resolve(import.meta.dirname, "..");
const WORKER_DIR = resolve(ROOT, "apps/api");
const E2E_PORT = 7017;
const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 60_000;

// ---------------------------------------------------------------------------
// Step 1: Apply D1 schema to local database
// ---------------------------------------------------------------------------

async function applySchema(): Promise<void> {
  const schemaPath = resolve(ROOT, "e2e/schema.sql");
  console.log("Step 1: Applying D1 schema to local database...");

  const proc = Bun.spawn(
    [
      "npx",
      "wrangler",
      "d1",
      "execute",
      "lyre-db-test",
      "--env",
      "test",
      "--local",
      "--file",
      schemaPath,
    ],
    {
      cwd: WORKER_DIR,
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error("FATAL: Failed to apply D1 schema");
    process.exit(1);
  }
  console.log("  Schema applied.");
}

// ---------------------------------------------------------------------------
// Step 2: Spawn dev server
// ---------------------------------------------------------------------------

function spawnDevServer(): Subprocess {
  console.log(`Step 2: Starting wrangler dev --env test on port ${E2E_PORT}...`);

  const proc = Bun.spawn(
    ["npx", "wrangler", "dev", "--env", "test", "--port", String(E2E_PORT)],
    {
      cwd: WORKER_DIR,
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  return proc;
}

// ---------------------------------------------------------------------------
// Step 3: Wait for server ready
// ---------------------------------------------------------------------------

async function waitForServer(): Promise<void> {
  const url = `http://localhost:${E2E_PORT}/api/live`;
  const start = Date.now();

  console.log(`Step 3: Waiting for server at ${url}...`);

  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const body = (await response.json()) as { status: string };
        if (body.status === "ok") {
          console.log(`  Server ready (${Date.now() - start}ms)`);
          return;
        }
      }
    } catch {
      // Server not up yet
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }

  console.error(`FATAL: Server did not start within ${MAX_WAIT_MS}ms`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 4: Run tests
// ---------------------------------------------------------------------------

async function runTests(): Promise<number> {
  console.log("\nStep 4: Running E2E tests...\n");

  const proc = Bun.spawn(["bun", "test", "--timeout", "15000", "e2e/api/"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });

  return proc.exited;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== L2: API E2E Test Runner ===\n");

  await applySchema();
  const server = spawnDevServer();
  let testExitCode = 1;

  try {
    await waitForServer();
    testExitCode = await runTests();
  } finally {
    console.log("\nStep 5: Stopping dev server...");
    server.kill();
    await server.exited;
    console.log("  Server stopped.");
  }

  if (testExitCode !== 0) {
    console.error("\n=== E2E tests FAILED ===\n");
    process.exit(1);
  }

  console.log("\n=== E2E tests PASSED ===\n");
}

void main();
