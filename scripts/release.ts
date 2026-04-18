#!/usr/bin/env bun
/**
 * Automated release script for lyre monorepo.
 *
 * Bumps version across all workspace package.json files,
 * syncs lockfile, generates CHANGELOG entries from conventional commits,
 * commits, tags, pushes, and creates a GitHub release.
 *
 * Usage:
 *   bun run release              # patch bump (default)
 *   bun run release -- minor     # minor bump
 *   bun run release -- major     # major bump
 *   bun run release -- 2.0.0     # explicit version
 *   bun run release -- --dry-run # preview without side effects
 *
 * Env:
 *   Requires `gh` CLI authenticated for GitHub release creation.
 */

import { execSync } from "child_process";
import { resolve as pathResolve } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = pathResolve(import.meta.dirname as string, "..");
const PACKAGE_JSON = pathResolve(PROJECT_ROOT, "package.json");
const CHANGELOG = pathResolve(PROJECT_ROOT, "CHANGELOG.md");
const MACOS_PROJECT_YML = pathResolve(PROJECT_ROOT, "apps/macos/project.yml");

// Workspace package.json files to keep in sync
const WORKSPACE_PACKAGES = [
  pathResolve(PROJECT_ROOT, "apps/web/package.json"),
].filter((p) => existsSync(p));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string, opts?: { dryRun?: boolean; cwd?: string }): string {
  const cwd = opts?.cwd ?? PROJECT_ROOT;
  if (opts?.dryRun) {
    console.log(`  [dry-run] ${cmd}`);
    return "";
  }
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "inherit"] }).trim();
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path: string, data: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function bumpVersion(current: string, bump: string): string {
  // If bump looks like an explicit semver, return it directly
  if (/^\d+\.\d+\.\d+/.test(bump)) return bump;

  const [major, minor, patch] = current.split(".").map(Number);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump type: ${bump}`);
  }
}

/**
 * Update MARKETING_VERSION in apps/macos/project.yml
 * Uses regex replacement to preserve YAML structure
 */
function updateMacosVersion(newVersion: string, dryRun: boolean): void {
  if (!existsSync(MACOS_PROJECT_YML)) {
    console.log("   [skip] apps/macos/project.yml not found");
    return;
  }

  const content = readFileSync(MACOS_PROJECT_YML, "utf-8");
  const versionMatch = content.match(/MARKETING_VERSION:\s*"([^"]+)"/);
  const currentVersion = versionMatch?.[1] ?? "unknown";

  console.log(`   apps/macos/project.yml: ${currentVersion} → ${newVersion}`);

  if (!dryRun) {
    const updated = content.replace(
      /MARKETING_VERSION:\s*"[^"]+"/,
      `MARKETING_VERSION: "${newVersion}"`,
    );
    writeFileSync(MACOS_PROJECT_YML, updated);
  }
}

/**
 * Regenerate Xcode project from project.yml
 */
function regenerateXcodeProject(dryRun: boolean): void {
  if (!existsSync(MACOS_PROJECT_YML)) return;

  const macosDir = pathResolve(PROJECT_ROOT, "apps/macos");
  run("xcodegen generate", { dryRun, cwd: macosDir });
}

// ---------------------------------------------------------------------------
// Changelog generation
// ---------------------------------------------------------------------------

function generateChangelog(newVersion: string, dryRun: boolean): string {
  const lastTag = run("git describe --tags --abbrev=0 2>/dev/null || echo ''").trim();
  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
  const rawLog = run(`git log ${range} --pretty=format:"%s (%h)" --no-merges`);

  if (!rawLog) return "";

  const lines = rawLog.split("\n").filter(Boolean);

  const categories: Record<string, string[]> = {
    "🚀 Features": [],
    "🐛 Bug Fixes": [],
    "📝 Other Changes": [],
  };

  for (const line of lines) {
    if (/^feat[\(:]/.test(line)) {
      categories["🚀 Features"].push(`- ${line}`);
    } else if (/^fix[\(:]/.test(line)) {
      categories["🐛 Bug Fixes"].push(`- ${line}`);
    } else {
      categories["📝 Other Changes"].push(`- ${line}`);
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  let entry = `## v${newVersion} (${date})\n\n`;

  for (const [heading, items] of Object.entries(categories)) {
    if (items.length > 0) {
      entry += `### ${heading}\n\n${items.join("\n")}\n\n`;
    }
  }

  // Prepend to CHANGELOG.md
  if (!dryRun) {
    const existing = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf-8") : "";
    const header = existing.startsWith("# Changelog") ? "" : "# Changelog\n\n";
    if (existing.startsWith("# Changelog")) {
      writeFileSync(CHANGELOG, existing.replace("# Changelog\n", `# Changelog\n\n${entry}`));
    } else {
      writeFileSync(CHANGELOG, `${header}${entry}${existing}`);
    }
  }

  return entry;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const bumpArg = args.find((a) => a !== "--dry-run") ?? "patch";

  // Read current version
  const rootPkg = readJson(PACKAGE_JSON);
  const currentVersion = rootPkg.version as string;
  const newVersion = bumpVersion(currentVersion, bumpArg);

  console.log(`\n📦 Release: v${currentVersion} → v${newVersion}${dryRun ? " (dry-run)" : ""}\n`);

  // 1. Bump version in root package.json
  console.log("1️⃣  Bumping versions...");
  if (!dryRun) {
    rootPkg.version = newVersion;
    writeJson(PACKAGE_JSON, rootPkg);
  }

  // Bump workspace packages
  for (const pkgPath of WORKSPACE_PACKAGES) {
    const pkg = readJson(pkgPath);
    console.log(`   ${pkgPath.replace(PROJECT_ROOT + "/", "")}: ${pkg.version} → ${newVersion}`);
    if (!dryRun) {
      pkg.version = newVersion;
      writeJson(pkgPath, pkg);
    }
  }

  // Bump macOS app version
  updateMacosVersion(newVersion, dryRun);

  // 2. Regenerate Xcode project
  console.log("\n2️⃣  Regenerating Xcode project...");
  regenerateXcodeProject(dryRun);

  // 3. Sync lockfile
  console.log("\n3️⃣  Syncing lockfile...");
  run("bun install", { dryRun });

  // 4. Generate changelog
  console.log("\n4️⃣  Generating CHANGELOG...");
  const changelogEntry = generateChangelog(newVersion, dryRun);
  if (changelogEntry) {
    console.log(changelogEntry);
  } else {
    console.log("   No commits found since last tag.");
  }

  // 5. Commit and tag
  console.log("5️⃣  Committing and tagging...");
  run("git add -A", { dryRun });
  run(`git commit -m "release: v${newVersion}"`, { dryRun });
  run(`git tag v${newVersion}`, { dryRun });

  // 6. Push
  console.log("\n6️⃣  Pushing...");
  run("git push", { dryRun });
  run("git push --tags", { dryRun });

  // 7. GitHub release
  console.log("\n7️⃣  Creating GitHub release...");
  const releaseNotes = changelogEntry || `Release v${newVersion}`;
  const notesFile = `/tmp/lyre-release-notes-${newVersion}.md`;
  if (!dryRun) {
    writeFileSync(notesFile, releaseNotes);
  }
  run(`gh release create v${newVersion} --title "v${newVersion}" --notes-file ${notesFile}`, { dryRun });

  console.log(`\n✅ Released v${newVersion}!`);
}

main();
