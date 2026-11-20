#!/usr/bin/env bun
/**
 * Automated release script for lyre monorepo.
 *
 * Bumps version across all workspace package.json files, syncs lockfile,
 * generates CHANGELOG entries from conventional commits, and then releases in
 * the order required by docs/12-agent-operations.md:
 *
 *   1. commit the version bump,
 *   2. push the commit to origin main,
 *   3. wait for the main CI run of that commit to succeed,
 *   4. wait for the matching Worker deployment (Release workflow) to succeed,
 *   5. create and push the annotated version tag,
 *   6. create the GitHub Release.
 *
 * Tagging before CI has proven the commit must not happen: the tag push races
 * the in-flight main CI run, the fail-closed release-source proof rejects it
 * ("No successful .github/workflows/ci.yml run on main for <sha>"), and a tag
 * pushed after CI passes would deploy the same commit a second time. The
 * Release workflow therefore has no `push` tag trigger — `workflow_run` on a
 * successful main CI run owns the production deployment.
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

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = pathResolve(import.meta.dirname as string, "..");
const PACKAGE_JSON = pathResolve(PROJECT_ROOT, "package.json");
const CHANGELOG = pathResolve(PROJECT_ROOT, "CHANGELOG.md");
const MACOS_PROJECT_YML = pathResolve(PROJECT_ROOT, "apps/macos/project.yml");

const REMOTE = "origin";
const RELEASE_BRANCH = "main";
const CI_WORKFLOW_FILE = "ci.yml";
const DEPLOY_WORKFLOW_FILE = "release.yml";
const POLL_SECONDS = 15;
const CI_TIMEOUT_MINUTES = 45;
const DEPLOY_TIMEOUT_MINUTES = 30;

// Workspace package.json files to keep in sync
const WORKSPACE_PACKAGES = [
	pathResolve(PROJECT_ROOT, "apps/web/package.json"),
	pathResolve(PROJECT_ROOT, "apps/api/package.json"),
	pathResolve(PROJECT_ROOT, "packages/api/package.json"),
].filter((p) => existsSync(p));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string, opts?: { dryRun?: boolean; cwd?: string; quiet?: boolean }): string {
	const cwd = opts?.cwd ?? PROJECT_ROOT;
	if (opts?.dryRun) {
		console.log(`  [dry-run] ${cmd}`);
		return "";
	}
	if (!opts?.quiet) {
		console.log(`  $ ${cmd}`);
	}
	return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "inherit"] }).trim();
}

function runStatus(cmd: string, opts?: { cwd?: string }): number {
	try {
		execSync(cmd, {
			cwd: opts?.cwd ?? PROJECT_ROOT,
			stdio: ["pipe", "pipe", "ignore"],
		});
		return 0;
	} catch (error) {
		const code = (error as { status?: number }).status;
		return typeof code === "number" ? code : 1;
	}
}

function sleepSeconds(seconds: number): void {
	execSync(`sleep ${seconds}`, { stdio: "ignore" });
}

function readJson(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path: string, data: Record<string, unknown>): void {
	writeFileSync(path, `${JSON.stringify(data, null, "\t")}\n`);
}

/**
 * Abort if the working tree has uncommitted changes.
 * Prevents accidentally bundling unrelated files into a release commit.
 */
function ensureCleanWorkingTree(): void {
	const status = execSync("git status --porcelain", {
		cwd: PROJECT_ROOT,
		encoding: "utf-8",
	}).trim();

	if (status) {
		console.error("\n❌ Working tree is dirty. Commit or stash changes before releasing.\n");
		console.error("Uncommitted files:");
		for (const line of status.split("\n")) {
			console.error(`   ${line}`);
		}
		process.exit(1);
	}
}

/**
 * The release commit has to land on `main` so that the CI run proving it and
 * the deployment triggered by it belong to the release branch.
 */
function ensureReleaseBranch(): void {
	const branch = run("git rev-parse --abbrev-ref HEAD");
	if (branch !== RELEASE_BRANCH) {
		console.error(
			`\n❌ Releases must be cut from '${RELEASE_BRANCH}', current branch is '${branch}'.\n`,
		);
		process.exit(1);
	}
}

/**
 * Refuse to release from a stale local main: the push below has to be a fast
 * forward, otherwise the CI run we wait for would not be the run of the
 * released commit.
 */
function ensureUpToDateWithRemote(): void {
	run(`git fetch ${REMOTE} ${RELEASE_BRANCH}`);
	const local = run("git rev-parse HEAD");
	const remote = run(`git rev-parse ${REMOTE}/${RELEASE_BRANCH}`);
	if (local !== remote) {
		console.error(
			`\n❌ Local ${RELEASE_BRANCH} (${local}) is not ${REMOTE}/${RELEASE_BRANCH} (${remote}).\n`,
		);
		console.error(`   Sync it first: git pull --rebase ${REMOTE} ${RELEASE_BRANCH}\n`);
		process.exit(1);
	}
}

/**
 * The CI / deployment evidence and the GitHub Release come from the GitHub
 * API, so an unauthenticated `gh` must fail before anything is pushed.
 */
function ensureGitHubCli(): void {
	if (runStatus("gh --version") !== 0) {
		console.error("\n❌ The GitHub CLI (`gh`) is required to release.\n");
		process.exit(1);
	}
	if (runStatus("gh auth status") !== 0) {
		console.error("\n❌ `gh` is not authenticated. Run `gh auth login` first.\n");
		process.exit(1);
	}
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
		if (/^feat[(:]/.test(line)) {
			categories["🚀 Features"].push(`- ${line}`);
		} else if (/^fix[(:]/.test(line)) {
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
// GitHub Actions evidence
// ---------------------------------------------------------------------------

interface WorkflowRun {
	databaseId: number;
	status: string;
	conclusion: string;
	event: string;
	headBranch: string;
	url: string;
}

function listWorkflowRuns(workflowFile: string, sha: string): WorkflowRun[] {
	const out = run(
		`gh run list --workflow ${workflowFile} --branch ${RELEASE_BRANCH} --commit ${sha} --limit 20 --json databaseId,status,conclusion,event,headBranch,url`,
		{ quiet: true },
	);
	if (!out.trim()) return [];
	const parsed: unknown = JSON.parse(out);
	return Array.isArray(parsed) ? (parsed as WorkflowRun[]) : [];
}

/**
 * Block until the workflow run for `sha` succeeded.
 *
 * Fails closed: a failed or missing run aborts the release before any tag is
 * created, so a broken commit can never be published as a release.
 */
function waitForSuccessfulRun(
	workflowFile: string,
	sha: string,
	timeoutMinutes: number,
	label: string,
	pick: (runs: WorkflowRun[]) => WorkflowRun[],
): void {
	const deadline = Date.now() + timeoutMinutes * 60_000;
	for (;;) {
		const runs = listWorkflowRuns(workflowFile, sha);
		const selected = pick(runs);
		if (!selected) {
			console.log(`   Waiting for the ${label} run of ${sha.slice(0, 7)} to appear...`);
		} else if (selected.status === "completed") {
			if (selected.conclusion === "success") {
				console.log(`   ${label} succeeded: ${selected.url}`);
				return;
			}
			console.error(`\n❌ ${label} run ${selected.url} concluded '${selected.conclusion}'.\n`);
			console.error(`   Inspect it, fix the cause, then re-run the release. No tag was created.\n`);
			process.exit(1);
		} else {
			console.log(`   ${label} still running: ${selected.url}`);
		}
		if (Date.now() >= deadline) {
			console.error(`\n❌ Timed out after ${timeoutMinutes} min waiting for the ${label} run.\n`);
			console.error(`   No tag was created.\n`);
			process.exit(1);
		}
		sleepSeconds(POLL_SECONDS);
	}
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

	// 0. Pre-flight: clean tree, release branch, up-to-date main
	if (!dryRun) {
		ensureCleanWorkingTree();
		ensureReleaseBranch();
		ensureUpToDateWithRemote();
		ensureGitHubCli();
	}

	// 1. Bump version in root package.json
	console.log("1️⃣  Bumping versions...");
	if (!dryRun) {
		rootPkg.version = newVersion;
		writeJson(PACKAGE_JSON, rootPkg);
	}

	// Bump workspace packages
	for (const pkgPath of WORKSPACE_PACKAGES) {
		const pkg = readJson(pkgPath);
		console.log(`   ${pkgPath.replace(`${PROJECT_ROOT}/`, "")}: ${pkg.version} → ${newVersion}`);
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

	// 5. Commit the release changes (no tag yet)
	console.log("5️⃣  Committing release changes...");
	const releaseFiles = [
		"package.json",
		"apps/web/package.json",
		"apps/api/package.json",
		"packages/api/package.json",
		"bun.lock",
		"CHANGELOG.md",
		"apps/macos/project.yml",
		"apps/macos/Lyre.xcodeproj/project.pbxproj",
		"apps/macos/Lyre.xcodeproj/xcshareddata/xcschemes/Lyre.xcscheme",
		"apps/macos/Lyre.xcodeproj/xcshareddata/xcschemes/LyreTests.xcscheme",
	].filter((p) => existsSync(pathResolve(PROJECT_ROOT, p)));
	run(`git add ${releaseFiles.join(" ")}`, { dryRun });

	// A retry of an already prepared version has nothing to commit; keep going
	// so the tag and the GitHub Release can still be created.
	const alreadyPrepared = dryRun ? false : runStatus("git diff --cached --quiet") === 0;
	if (alreadyPrepared) {
		console.log("   No version changes to commit — reusing the current HEAD commit.");
	} else {
		run(`git commit -m "chore: release v${newVersion}"`, { dryRun });
	}
	const releaseSha = dryRun ? "<release-commit-sha>" : run("git rev-parse HEAD");
	console.log(`   Release commit: ${releaseSha}`);

	// 6. Push the release commit first — the tag may only follow a proven CI run
	console.log(`\n6️⃣  Pushing the release commit to ${REMOTE} ${RELEASE_BRANCH}...`);
	run(`git push ${REMOTE} HEAD:${RELEASE_BRANCH}`, { dryRun });

	// 7. Wait for the main CI run of the release commit
	console.log("\n7️⃣  Waiting for main CI to succeed...");
	if (dryRun) {
		console.log(`   [dry-run] wait for a successful ${CI_WORKFLOW_FILE} run of ${releaseSha}`);
	} else {
		waitForSuccessfulRun(
			CI_WORKFLOW_FILE,
			releaseSha,
			CI_TIMEOUT_MINUTES,
			"CI",
			(runs) =>
				runs
					.filter((run) => run.event === "push" && run.headBranch === RELEASE_BRANCH)
					.sort((a, b) => b.databaseId - a.databaseId)[0],
		);
	}

	// 8. Wait for the Worker deployment the successful CI run triggered
	console.log("\n8️⃣  Waiting for the Worker deployment to succeed...");
	if (dryRun) {
		console.log(`   [dry-run] wait for a successful ${DEPLOY_WORKFLOW_FILE} run of ${releaseSha}`);
	} else {
		waitForSuccessfulRun(
			DEPLOY_WORKFLOW_FILE,
			releaseSha,
			DEPLOY_TIMEOUT_MINUTES,
			"Deployment",
			(runs) => {
				const triggered = runs
					.filter((run) => run.event === "workflow_run")
					.sort((a, b) => b.databaseId - a.databaseId);
				return triggered[0] ?? runs.sort((a, b) => b.databaseId - a.databaseId)[0];
			},
		);
	}

	// 9. Tag and push the tag — only now, with green CI and a live deployment
	console.log(`\n9️⃣  Tagging v${newVersion}...`);
	const tagExists =
		!dryRun && runStatus(`git rev-parse -q --verify refs/tags/v${newVersion}`) === 0;
	if (tagExists) {
		console.log(`   Tag v${newVersion} already exists — keeping it.`);
	} else {
		run(`git tag -a v${newVersion} -m "Release v${newVersion}"`, { dryRun });
	}
	run(`git push ${REMOTE} v${newVersion}`, { dryRun });

	// 10. GitHub release
	console.log("\n🔟  Creating GitHub release...");
	const releaseNotes = changelogEntry || `Release v${newVersion}`;
	const notesFile = `/tmp/lyre-release-notes-${newVersion}.md`;
	if (!dryRun) {
		writeFileSync(notesFile, releaseNotes);
	}
	run(`gh release create v${newVersion} --title "v${newVersion}" --notes-file ${notesFile}`, {
		dryRun,
	});

	console.log(`\n✅ Released v${newVersion}!`);
}

main();
