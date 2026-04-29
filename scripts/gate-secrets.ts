/**
 * Security gate: gitleaks secrets scanning.
 *
 * Runs `gitleaks protect --staged` to scan staged changes for leaked secrets.
 * Designed for pre-commit hook usage.
 *
 * Usage: bun run gate:secrets
 */

import { spawn } from "bun";

async function main(): Promise<void> {
  // Check gitleaks is installed
  const check = spawn(["which", "gitleaks"], { stdout: null, stderr: null });
  if ((await check.exited) !== 0) {
    console.error("gitleaks not installed — install: brew install gitleaks");
    process.exit(1);
  }

  const proc = spawn(["gitleaks", "protect", "--staged", "--no-banner"], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error("Secrets scan failed — commit blocked.");
  }
  process.exit(exitCode);
}

void main();
