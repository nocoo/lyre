#!/usr/bin/env bun
/**
 * Automated release script for lyre monorepo.
 *
 * Bumps the version across all workspace package.json files, syncs the
 * lockfile, generates the CHANGELOG entry from conventional commits, and then
 * releases in the order required by docs/12-agent-operations.md:
 *
 *   1. commit the version bump (or reuse an already committed release),
 *   2. push that commit to origin main (skipped when it is already merged),
 *   3. wait for the successful main CI run of that commit,
 *   4. wait for the Worker deployment that proved exactly that CI run,
 *   5. check the production health endpoint,
 *   6. create and push the annotated version tag bound to that commit,
 *   7. create the GitHub Release as a draft.
 *
 * `main` is protected by a ruleset that requires the "quality / Z1: Gate"
 * check, so a fresh release commit cannot be pushed directly. The script
 * detects the rejected push and asks for a pull request instead; the re-run
 * resumes from the merged commit without bumping the version again and
 * without duplicating the CHANGELOG entry.
 *
 * A deploy trigger must carry evidence that is already green: the tag is the
 * last step of a release, never the trigger of one. The GitHub Release stays a
 * draft until the macOS DMG and SHA256SUMS are attached.
 *
 * Usage:
 *   bun run release              # patch bump (default)
 *   bun run release -- minor     # minor bump
 *   bun run release -- major     # major bump
 *   bun run release -- 2.0.0     # explicit version (also used to resume)
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
const COMMAND_TIMEOUT_MS = 120_000;
const PRODUCTION_LIVE_URL = "https://lyre.hexly.ai/api/live";
const HEALTH_ATTEMPTS = 3;
const HEALTH_RETRY_SECONDS = 5;

// Workspace package.json files to keep in sync
const WORKSPACE_PACKAGES = [
	pathResolve(PROJECT_ROOT, "apps/web/package.json"),
	pathResolve(PROJECT_ROOT, "apps/api/package.json"),
	pathResolve(PROJECT_ROOT, "packages/api/package.json"),
].filter((p) => existsSync(p));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RunOptions {
	dryRun?: boolean;
	cwd?: string;
	quiet?: boolean;
	timeout?: number;
}

function run(cmd: string, opts?: RunOptions): string {
	const cwd = opts?.cwd ?? PROJECT_ROOT;
	if (opts?.dryRun) {
		console.log(`  [dry-run] ${cmd}`);
		return "";
	}
	if (!opts?.quiet) {
		console.log(`  $ ${cmd}`);
	}
	try {
		return execSync(cmd, {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "inherit"],
			timeout: opts?.timeout ?? COMMAND_TIMEOUT_MS,
		}).trim();
	} catch (error) {
		const failure = error as { status?: number | null; signal?: string };
		if (failure.signal === "SIGTERM") {
			throw new Error(
				`Command timed out after ${(opts?.timeout ?? COMMAND_TIMEOUT_MS) / 1000}s: ${cmd}`,
			);
		}
		throw error;
	}
}

function runStatus(cmd: string, opts?: { cwd?: string; timeout?: number }): number {
	try {
		execSync(cmd, {
			cwd: opts?.cwd ?? PROJECT_ROOT,
			stdio: ["pipe", "pipe", "ignore"],
			timeout: opts?.timeout ?? COMMAND_TIMEOUT_MS,
		});
		return 0;
	} catch (error) {
		const code = (error as { status?: number | null }).status;
		return typeof code === "number" ? code : 1;
	}
}

function fail(message: string, hint?: string): never {
	console.error(`\n❌ ${message}\n`);
	if (hint) {
		console.error(`${hint}\n`);
	}
	process.exit(1);
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

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function gitSha(ref: string): string {
	return run(`git rev-parse ${ref}`).trim();
}

function localTagExists(tag: string): boolean {
	return runStatus(`git rev-parse -q --verify refs/tags/${tag}`) === 0;
}

/** Commit a local tag points at; annotated tags are dereferenced. */
function localTagCommit(tag: string): string {
	return run(`git rev-list -n 1 refs/tags/${tag}`).trim();
}

/**
 * Commit a remote tag points at, or "" when the remote has no such tag.
 * `git ls-remote` reports the tag object for annotated tags and the commit
 * for lightweight tags; the `^{}` ref peels an annotated tag to its commit.
 */
function remoteTagCommit(tag: string): string {
	const out = run(`git ls-remote ${REMOTE} "refs/tags/${tag}" "refs/tags/${tag}^{}"`);
	let direct = "";
	let peeled = "";
	for (const line of out.split("\n")) {
		const [sha, ref] = line.split(/\s+/);
		if (!sha || !ref) continue;
		if (ref === `refs/tags/${tag}`) direct = sha;
		if (ref === `refs/tags/${tag}^{}`) peeled = sha;
	}
	return peeled || direct;
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
		fail(
			`Releases must be cut from '${RELEASE_BRANCH}', current branch is '${branch}'.`,
			`   Switch first: git switch ${RELEASE_BRANCH}\n`,
		);
	}
}

/**
 * Refuse to release from a diverged local main: the push has to be a fast
 * forward of origin/main, otherwise the CI run we wait for would not be the
 * run of the released commit.
 */
function ensureUpToDateWithRemote(): void {
	run(`git fetch ${REMOTE} ${RELEASE_BRANCH}`);
	if (runStatus(`git merge-base --is-ancestor ${REMOTE}/${RELEASE_BRANCH} HEAD`) !== 0) {
		fail(
			`Local ${RELEASE_BRANCH} has diverged from ${REMOTE}/${RELEASE_BRANCH}.`,
			`   Sync it first: git pull --rebase ${REMOTE} ${RELEASE_BRANCH}\n`,
		);
	}
}

/**
 * The GitHub API, the run list and the release evidence come from `gh`.
 */
function ensureGitHubCli(): void {
	if (runStatus("gh --version") !== 0) {
		fail("The GitHub CLI (`gh`) is required to release.");
	}
	if (runStatus("gh auth status") !== 0) {
		fail("`gh` is not authenticated.", "   Run `gh auth login` first.\n");
	}
}

/**
 * A version whose commit is already on origin/main but which has no tag is an
 * unfinished release. Bumping past it would skip a published version number.
 */
function assertNoSkippedVersion(currentVersion: string, targetVersion: string): void {
	if (currentVersion === targetVersion) return;
	const tag = `v${currentVersion}`;
	if (localTagExists(tag) || remoteTagCommit(tag)) return;
	if (gitSha("HEAD") !== gitSha(`${REMOTE}/${RELEASE_BRANCH}`)) return;
	fail(
		`v${currentVersion} is committed on ${REMOTE} ${RELEASE_BRANCH} but has no tag.`,
		`   Finish that release first:  bun run release -- ${currentVersion}\n` +
			`   A bare "bun run release" would skip v${currentVersion}.\n`,
	);
}

function bumpVersion(current: string, bump: string): string {
	// If bump looks like an explicit semver, return it directly
	if (/^\d+\.\d+\.\d+/.test(bump)) return bump;

	const parts = current.split(".").map(Number);
	const major = parts[0] ?? 0;
	const minor = parts[1] ?? 0;
	const patch = parts[2] ?? 0;
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

/** The CHANGELOG entry of `version`, or "" when the file has none. */
function findChangelogEntry(version: string): string {
	if (!existsSync(CHANGELOG)) return "";
	const content = readFileSync(CHANGELOG, "utf-8");
	const escaped = version.replace(/\./g, "\\.");
	const start = new RegExp(`^## v${escaped}\\b`, "m").exec(content);
	if (!start) return "";
	const rest = content.slice(start.index + start[0].length);
	const next = rest.search(/\n## /);
	return next === -1
		? content.slice(start.index)
		: content.slice(start.index, start.index + start[0].length + next);
}

/** The CHANGELOG entry for `version` built from the commits since the last tag. */
function buildChangelogEntry(version: string): string {
	const lastTag = run("git describe --tags --abbrev=0 2>/dev/null || echo ''").trim();
	const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
	const rawLog = run(`git log ${range} --pretty=format:"%s (%h)" --no-merges`);

	if (!rawLog) return "";

	const lines = rawLog.split("\n").filter(Boolean);

	const categories = {
		"🚀 Features": [] as string[],
		"🐛 Bug Fixes": [] as string[],
		"📝 Other Changes": [] as string[],
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
	let entry = `## v${version} (${date})\n\n`;

	for (const [heading, items] of Object.entries(categories)) {
		if (items.length > 0) {
			entry += `### ${heading}\n\n${items.join("\n")}\n\n`;
		}
	}

	return entry;
}

/** Prepend a CHANGELOG entry to CHANGELOG.md. */
function prependChangelog(entry: string): void {
	const existing = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf-8") : "";
	const header = existing.startsWith("# Changelog") ? "" : "# Changelog\n\n";
	if (existing.startsWith("# Changelog")) {
		writeFileSync(CHANGELOG, existing.replace("# Changelog\n", `# Changelog\n\n${entry}`));
	} else {
		writeFileSync(CHANGELOG, `${header}${entry}${existing}`);
	}
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
	headSha: string;
	url: string;
}

interface Deadline {
	at: number;
	label: string;
}

function createDeadline(minutes: number, label: string): Deadline {
	return { at: Date.now() + minutes * 60_000, label };
}

function remainingMs(deadline: Deadline): number {
	return deadline.at - Date.now();
}

function listWorkflowRuns(workflowFile: string, sha: string, timeout: number): WorkflowRun[] {
	const out = run(
		`gh run list --workflow ${workflowFile} --branch ${RELEASE_BRANCH} --commit ${sha} --limit 20 --json databaseId,status,conclusion,event,headBranch,headSha,url`,
		{ quiet: true, timeout },
	);
	if (!out.trim()) return [];
	const parsed: unknown = JSON.parse(out);
	return Array.isArray(parsed) ? (parsed as WorkflowRun[]) : [];
}

interface WaitOptions {
	workflowFile: string;
	sha: string;
	deadline: Deadline;
	select: (runs: WorkflowRun[]) => WorkflowRun | undefined;
	/** null accepts the run, a string rejects it with the reason. */
	accept: (run: WorkflowRun) => string | null;
	rejectionHint?: string;
}

/**
 * Block until a workflow run for `sha` is accepted.
 *
 * Fails closed: a failed, mismatched or missing run aborts the release before
 * any tag is created, so a broken commit can never be published.
 */
function waitForWorkflowRun(options: WaitOptions): WorkflowRun {
	for (;;) {
		const remaining = remainingMs(options.deadline);
		if (remaining <= 0) {
			fail(
				`Timed out after ${options.deadline.label} waiting for a ${options.workflowFile} run of ${options.sha}.`,
				`   No tag was created.\n`,
			);
		}
		const runs = listWorkflowRuns(
			options.workflowFile,
			options.sha,
			Math.min(COMMAND_TIMEOUT_MS, remaining),
		);
		if (remainingMs(options.deadline) <= 0) {
			fail(
				`Timed out after ${options.deadline.label} waiting for a ${options.workflowFile} run of ${options.sha}.`,
				`   The result arrived after the deadline and was not accepted. No tag was created.\n`,
			);
		}

		const candidate = options.select(runs);
		if (!candidate) {
			console.log(
				`   Waiting for the ${options.workflowFile} run of ${options.sha.slice(0, 7)} to appear...`,
			);
		} else if (candidate.status !== "completed") {
			console.log(`   ${options.workflowFile} still running: ${candidate.url}`);
		} else {
			const rejection = options.accept(candidate);
			if (rejection === null) {
				console.log(`   ${options.workflowFile} succeeded: ${candidate.url}`);
				return candidate;
			}
			fail(
				`${options.workflowFile} run ${candidate.url} rejected: ${rejection}.`,
				options.rejectionHint ?? `   No tag was created.\n`,
			);
		}

		const sleepMs = Math.min(POLL_SECONDS * 1000, Math.max(0, remainingMs(options.deadline)));
		if (sleepMs <= 0) continue;
		sleepSeconds(sleepMs / 1000);
	}
}

/**
 * Proof that a deployment run resolved exactly the given CI run and commit.
 * The release-source action prints the proven SHA and run ID into its log.
 */
function deploymentProvesRun(
	deployment: WorkflowRun,
	sha: string,
	ciRunId: number,
): { ok: boolean; detail: string } {
	let log: string;
	try {
		log = run(`gh run view ${deployment.databaseId} --log`, { quiet: true });
	} catch (error) {
		return { ok: false, detail: `its log could not be read (${(error as Error).message})` };
	}
	const expected = `Resolved release source ${sha} run ${ciRunId}`;
	if (log.includes(expected)) {
		return { ok: true, detail: expected };
	}
	const found = /Resolved release source [0-9a-f]{40} run \d+/.exec(log);
	return {
		ok: false,
		detail: found
			? `it proved "${found[0]}" instead of "${expected}"`
			: `it contains no release-source proof of "${expected}"`,
	};
}

// ---------------------------------------------------------------------------
// Release steps
// ---------------------------------------------------------------------------

/**
 * Confirm the production Worker answers with the released version.
 * The deployment run verifies the same endpoint; this is the local
 * confirmation. A version mismatch is fatal, an unreachable endpoint is not:
 * the deploy run's own verify-command is the recorded evidence.
 */
function verifyProductionHealth(version: string): void {
	for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++) {
		let body: string;
		try {
			body = run(`curl -fsS --max-time 20 ${PRODUCTION_LIVE_URL}`, {
				quiet: true,
				timeout: 30_000,
			});
		} catch {
			console.log(`   ${PRODUCTION_LIVE_URL} unreachable (attempt ${attempt}/${HEALTH_ATTEMPTS}).`);
			sleepSeconds(HEALTH_RETRY_SECONDS);
			continue;
		}
		let reported = "";
		try {
			reported = String((JSON.parse(body) as { version?: string }).version ?? "");
		} catch {
			reported = "";
		}
		if (reported === version) {
			console.log(`   ${PRODUCTION_LIVE_URL} reports v${reported}.`);
			return;
		}
		fail(
			`${PRODUCTION_LIVE_URL} reports v${reported || "?"} but the release is v${version}.`,
			`   The deployment does not match the released version. No tag was created.\n`,
		);
	}
	console.log(
		`   Could not reach ${PRODUCTION_LIVE_URL} locally; the deployment run's own verify-command is the recorded evidence.`,
	);
}

/**
 * Create the annotated tag on the release commit, or prove that an existing
 * tag points at exactly that commit.
 */
function ensureTag(version: string, sha: string, dryRun: boolean): void {
	const tag = `v${version}`;
	if (localTagExists(tag)) {
		const local = localTagCommit(tag);
		if (local !== sha) {
			fail(
				`Local tag ${tag} points at ${local}, not at the release commit ${sha}.`,
				`   Move or delete the stale tag before releasing. No tag was pushed.\n`,
			);
		}
		console.log(`   Local tag ${tag} already points at the release commit.`);
	} else {
		run(`git tag -a ${tag} ${sha} -m "v${version}"`, { dryRun });
	}

	const remote = remoteTagCommit(tag);
	if (remote) {
		if (remote !== sha) {
			fail(
				`Remote tag ${tag} points at ${remote}, not at the release commit ${sha}.`,
				`   Move or delete the remote tag before releasing. No tag was pushed.\n`,
			);
		}
		console.log(`   Remote tag ${tag} already points at the release commit.`);
		return;
	}
	run(`git push ${REMOTE} ${tag}`, { dryRun });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
	const args = process.argv.slice(2);
	const dryRun = args.includes("--dry-run");
	const bumpArg = args.find((a) => a !== "--dry-run" && a !== "--") ?? "patch";

	// Read current version
	const rootPkg = readJson(PACKAGE_JSON);
	const currentVersion = rootPkg.version as string;
	const targetVersion = bumpVersion(currentVersion, bumpArg);
	const resuming = currentVersion === targetVersion;

	console.log(
		`\n📦 Release: v${currentVersion} → v${targetVersion}${dryRun ? " (dry-run)" : ""}\n`,
	);
	if (resuming) {
		console.log(
			`   Resuming v${targetVersion}: the version is already committed on ${RELEASE_BRANCH}.\n`,
		);
	}

	// 0. Pre-flight: clean tree, release branch, synced main, authenticated gh
	if (!dryRun) {
		ensureCleanWorkingTree();
		ensureReleaseBranch();
		ensureUpToDateWithRemote();
		ensureGitHubCli();
		assertNoSkippedVersion(currentVersion, targetVersion);
	}

	let releaseSha = "";
	let notes = "";

	if (resuming) {
		// The release commit is already merged; reuse it without touching it.
		releaseSha = gitSha("HEAD");
		if (!dryRun && releaseSha !== gitSha(`${REMOTE}/${RELEASE_BRANCH}`)) {
			fail(
				`The release commit ${releaseSha.slice(0, 7)} is not on ${REMOTE} ${RELEASE_BRANCH}.`,
				`   Merge the release commit into ${RELEASE_BRANCH} first, then re-run:\n` +
					`     bun run release -- ${targetVersion}\n`,
			);
		}
		notes = findChangelogEntry(targetVersion);
		if (!notes) {
			notes = buildChangelogEntry(targetVersion);
			console.log(
				`   CHANGELOG.md has no entry for v${targetVersion}; the release notes are built from the commits since the last tag.`,
			);
		}
		console.log(
			`1️⃣  Reusing the merged release commit ${releaseSha.slice(0, 7)} — no version bump, no commit, no push.\n`,
		);
	} else {
		// 1. Bump version in root package.json
		console.log("1️⃣  Bumping versions...");
		if (!dryRun) {
			rootPkg.version = targetVersion;
			writeJson(PACKAGE_JSON, rootPkg);
		}

		// Bump workspace packages
		for (const pkgPath of WORKSPACE_PACKAGES) {
			const pkg = readJson(pkgPath);
			console.log(
				`   ${pkgPath.replace(`${PROJECT_ROOT}/`, "")}: ${pkg.version} → ${targetVersion}`,
			);
			if (!dryRun) {
				pkg.version = targetVersion;
				writeJson(pkgPath, pkg);
			}
		}

		// Bump macOS app version
		updateMacosVersion(targetVersion, dryRun);

		// 2. Regenerate Xcode project
		console.log("\n2️⃣  Regenerating Xcode project...");
		regenerateXcodeProject(dryRun);

		// 3. Sync lockfile
		console.log("\n3️⃣  Syncing lockfile...");
		run("bun install", { dryRun });

		// 4. Generate changelog
		console.log("\n4️⃣  Generating CHANGELOG...");
		const existingEntry = findChangelogEntry(targetVersion);
		if (existingEntry) {
			notes = existingEntry;
			console.log(`   CHANGELOG entry for v${targetVersion} already exists — keeping it.`);
		} else {
			notes = buildChangelogEntry(targetVersion);
			if (!dryRun) {
				prependChangelog(notes);
			}
		}
		if (notes) {
			console.log(notes);
		} else {
			console.log("   No commits found since last tag.");
		}

		// 5. Commit the release changes (no tag yet)
		console.log("\n5️⃣  Committing release changes...");
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

		// A retry of an already prepared version has nothing to commit; keep
		// going so the tag and the GitHub Release can still be created.
		const alreadyPrepared = dryRun ? false : runStatus("git diff --cached --quiet") === 0;
		if (alreadyPrepared) {
			console.log("   No version changes to commit — reusing the current HEAD commit.");
		} else {
			run(`git commit -m "chore: release v${targetVersion}"`, { dryRun });
		}
		releaseSha = dryRun ? "<release-commit-sha>" : gitSha("HEAD");
		console.log(`   Release commit: ${releaseSha}`);

		// 6. Push the release commit first — the tag may only follow a proven CI run
		console.log(`\n6️⃣  Pushing the release commit to ${REMOTE} ${RELEASE_BRANCH}...`);
		if (!dryRun) {
			try {
				run(`git push ${REMOTE} HEAD:${RELEASE_BRANCH}`);
			} catch {
				fail(
					`GitHub rejected the direct push to ${REMOTE} ${RELEASE_BRANCH}.`,
					`   The ${RELEASE_BRANCH} ruleset requires the "quality / Z1: Gate" check on the\n` +
						`   new SHA, so a fresh release commit cannot be pushed directly. Push it\n` +
						`   through a pull request instead:\n\n` +
						`     git switch -c chore/release-v${targetVersion}\n` +
						`     git push -u ${REMOTE} chore/release-v${targetVersion}\n` +
						`     # open a PR into ${RELEASE_BRANCH} and merge it without squashing,\n` +
						`     # so the release commit keeps its SHA\n` +
						`     git switch ${RELEASE_BRANCH}\n` +
						`     git fetch ${REMOTE} ${RELEASE_BRANCH} && git reset --hard ${REMOTE}/${RELEASE_BRANCH}\n\n` +
						`   Then finish the release with:\n` +
						`     bun run release -- ${targetVersion}\n\n` +
						`   The re-run resumes from the merged commit: it does not re-bump the\n` +
						`   version and does not duplicate the CHANGELOG entry.\n`,
				);
			}
		} else {
			run(`git push ${REMOTE} HEAD:${RELEASE_BRANCH}`, { dryRun });
		}
	}

	// 7. Wait for the main CI run of the release commit
	console.log("\n7️⃣  Waiting for main CI to succeed...");
	let ciRunId = 0;
	if (dryRun) {
		console.log(`   [dry-run] wait for a successful ${CI_WORKFLOW_FILE} run of ${releaseSha}`);
	} else {
		const ciRun = waitForWorkflowRun({
			workflowFile: CI_WORKFLOW_FILE,
			sha: releaseSha,
			deadline: createDeadline(CI_TIMEOUT_MINUTES, `${CI_TIMEOUT_MINUTES} min`),
			select: (runs) =>
				runs
					.filter(
						(run) =>
							run.event === "push" &&
							run.headBranch === RELEASE_BRANCH &&
							run.headSha === releaseSha,
					)
					.sort((a, b) => b.databaseId - a.databaseId)[0],
			accept: (run) => (run.conclusion === "success" ? null : `it concluded '${run.conclusion}'`),
			rejectionHint: `   Fix the failing CI run, then re-run:\n     bun run release -- ${targetVersion}\n`,
		});
		ciRunId = ciRun.databaseId;
		console.log(`   CI run ${ciRunId} proved ${releaseSha.slice(0, 7)}.`);
	}

	// 8. Wait for the Worker deployment that proved exactly that CI run
	console.log("\n8️⃣  Waiting for the Worker deployment to succeed...");
	if (dryRun) {
		console.log(`   [dry-run] wait for a successful ${DEPLOY_WORKFLOW_FILE} run of ${releaseSha}`);
	} else {
		waitForWorkflowRun({
			workflowFile: DEPLOY_WORKFLOW_FILE,
			sha: releaseSha,
			deadline: createDeadline(DEPLOY_TIMEOUT_MINUTES, `${DEPLOY_TIMEOUT_MINUTES} min`),
			select: (runs) =>
				runs
					.filter((run) => run.event === "workflow_run" && run.headSha === releaseSha)
					.sort((a, b) => b.databaseId - a.databaseId)[0],
			accept: (run) => {
				if (run.conclusion !== "success") {
					return `it concluded '${run.conclusion}'`;
				}
				const proof = deploymentProvesRun(run, releaseSha, ciRunId);
				return proof.ok ? null : `it did not prove CI run ${ciRunId} (${proof.detail})`;
			},
			rejectionHint:
				`   The deployment must prove CI run ${ciRunId} on ${releaseSha.slice(0, 7)}.\n` +
				`   Fix the deployment, then re-run:\n     bun run release -- ${targetVersion}\n`,
		});
	}

	// 9. Confirm the production Worker answers with the released version
	console.log("\n9️⃣  Checking the production health endpoint...");
	if (dryRun) {
		console.log(`   [dry-run] check ${PRODUCTION_LIVE_URL} reports v${targetVersion}`);
	} else {
		verifyProductionHealth(targetVersion);
	}

	// 10. Tag and push the tag — only now, with green CI and a live deployment
	console.log(`\n🔟  Tagging v${targetVersion}...`);
	ensureTag(targetVersion, releaseSha, dryRun);

	// 11. GitHub release — a draft until the DMG and SHA256SUMS are attached
	console.log("\n1️⃣1️⃣  Creating the GitHub release draft...");
	const releaseNotes = notes || `Release v${targetVersion}`;
	const notesFile = `/tmp/lyre-release-notes-${targetVersion}.md`;
	if (dryRun) {
		run(
			`gh release create v${targetVersion} --draft --title "v${targetVersion}" --notes-file ${notesFile}`,
			{ dryRun },
		);
	} else {
		if (runStatus(`gh release view v${targetVersion}`) === 0) {
			console.log(`   GitHub release v${targetVersion} already exists — keeping it as a draft.`);
		} else {
			writeFileSync(notesFile, releaseNotes);
			run(
				`gh release create v${targetVersion} --draft --title "v${targetVersion}" --notes-file ${notesFile}`,
			);
		}
	}

	console.log(`\n✅ Released v${targetVersion}!`);
	console.log(
		`   The GitHub release is a draft: attach the macOS DMG and SHA256SUMS, then publish it\n` +
			`   (see docs/12-agent-operations.md).\n`,
	);
}

main();
