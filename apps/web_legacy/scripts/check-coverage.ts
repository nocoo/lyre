#!/usr/bin/env bun
/**
 * Coverage Check Script
 *
 * Runs unit tests with coverage and fails if coverage falls below threshold.
 */

const THRESHOLD = 95; // Minimum line coverage percentage

async function main() {
  console.log("Running unit tests with coverage...\n");

  // Discover all test files under src/__tests__/. Using a glob keeps
  // the list in sync automatically as new tests are added.
  const glob = new Bun.Glob("src/__tests__/*.test.ts");
  const testFiles = Array.from(glob.scanSync(".")).sort();

  // Run tests with coverage
  const proc = Bun.spawn(
    ["bun", "test", ...testFiles, "--coverage"],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const output = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  // Print output
  console.log(output);
  if (stderr) console.error(stderr);

  await proc.exited;

  // Combine stdout and stderr for parsing
  const fullOutput = output + stderr;

  // Parse coverage from output - look for "All files" line
  const lines = fullOutput.split("\n");
  const allFilesLine = lines.find((line) => line.includes("All files"));

  if (!allFilesLine) {
    console.error("Could not parse coverage output");
    process.exit(1);
  }

  // Parse line coverage percentage (3rd column after "All files")
  // Format: "All files                                |   90.77 |   95.61 |"
  const match = allFilesLine.match(
    /All files\s*\|\s*[\d.]+\s*\|\s*([\d.]+)\s*\|/
  );
  if (!match) {
    console.error(
      "Could not parse coverage percentage from:",
      allFilesLine
    );
    process.exit(1);
  }

  const lineCoverage = parseFloat(match[1] ?? "0");
  console.log(`\nLine Coverage: ${lineCoverage.toFixed(2)}%`);
  console.log(`Threshold: ${THRESHOLD}%`);

  if (lineCoverage < THRESHOLD) {
    console.error(
      `\nCoverage ${lineCoverage.toFixed(2)}% is below threshold ${THRESHOLD}%`
    );
    process.exit(1);
  }

  console.log("\nCoverage check passed!");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
