/**
 * Security gate: osv-scanner dependency vulnerability scanning.
 *
 * Runs `osv-scanner scan --lockfile=bun.lock` to check for known
 * vulnerabilities in dependencies. Designed for pre-push hook usage.
 *
 * Usage: bun run gate:deps
 */

import { spawn } from "bun";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

async function main(): Promise<void> {
  // Check osv-scanner is installed
  const check = spawn(["which", "osv-scanner"], { stdout: null, stderr: null });
  if ((await check.exited) !== 0) {
    console.error("osv-scanner not installed — install: brew install osv-scanner");
    process.exit(1);
  }

  const lockfile = resolve(ROOT, "bun.lock");
  const args = ["scan", `--lockfile=${lockfile}`];

  // Use config if present
  const configPath = resolve(ROOT, "osv-scanner.toml");
  const configCheck = spawn(["test", "-f", configPath], { stdout: null, stderr: null });
  if ((await configCheck.exited) === 0) {
    args.push(`--config=${configPath}`);
  }

  const proc = spawn(["osv-scanner", ...args], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error("Dependency vulnerability scan failed — push blocked.");
  }
  process.exit(exitCode);
}

void main();
