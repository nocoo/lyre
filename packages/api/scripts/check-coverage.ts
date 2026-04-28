#!/usr/bin/env bun
/**
 * Coverage check for `@lyre/api` handler tests.
 *
 * Runs `bun test --coverage` with coverage scoped to `src/handlers/**`
 * and fails if line coverage falls below `THRESHOLD`.
 */

const THRESHOLD = 90;

async function main() {
  console.log("Running @lyre/api handler tests with coverage...\n");

  const proc = Bun.spawn(
    [
      "bun",
      "test",
      "src/__tests__/handlers",
      "--coverage",
      "--coverage-reporter=text",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const output = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  console.log(output);
  if (stderr) console.error(stderr);
  await proc.exited;

  const full = output + stderr;
  const lines = full.split("\n");
  // Only consider rows under src/handlers/.
  const handlerRows = lines.filter((l) => l.includes("handlers/") && l.includes("|"));
  if (handlerRows.length === 0) {
    console.error("No handler coverage rows found in output");
    process.exit(1);
  }

  // Parse `<file> | <funcs%> | <lines%> | ...`
  let total = 0;
  let count = 0;
  let worstName = "";
  let worst = 100;
  for (const row of handlerRows) {
    const m = row.match(/\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/);
    if (!m) continue;
    const lineCov = parseFloat(m[2] ?? "0");
    total += lineCov;
    count++;
    if (lineCov < worst) {
      worst = lineCov;
      worstName = row.trim().split("|")[0]?.trim() ?? "";
    }
  }
  if (count === 0) {
    console.error("Failed to parse any handler coverage row");
    process.exit(1);
  }
  const avg = total / count;
  console.log(`\nHandler line coverage avg: ${avg.toFixed(2)}%`);
  console.log(`Threshold: ${THRESHOLD}%`);
  console.log(`Lowest file: ${worstName} @ ${worst.toFixed(2)}%`);

  if (avg < THRESHOLD) {
    console.error(
      `\nCoverage ${avg.toFixed(2)}% is below threshold ${THRESHOLD}%`,
    );
    process.exit(1);
  }
  console.log("\nCoverage check passed!");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
