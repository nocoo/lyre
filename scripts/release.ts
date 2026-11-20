#!/usr/bin/env bun
/**
 * Automated release script for lyre monorepo.
 *
 * Two phases, because `main` is protected by a ruleset that requires the
 * "quality / Z1: Gate" check and a fresh release commit must never be pushed
 * straight to it:
 *
 *   bun run release [-- <bump|version>]   phase 1: prepare the release branch
 *   bun run release -- <version>          phase 2: finish the release
 *
 * Phase 1 (run on `main` while package.json still carries the old version)
 * bumps the version everywhere, regenerates the Xcode project, syncs the
 * lockfile, writes the CHANGELOG entry, commits everything on the release
 * branch `chore/release-v<version>` and pushes that branch through the normal
 * hooks. It then prints the pull request command; the PR carries the CI
 * evidence and is merged without squashing so the release commit keeps its
 * SHA. `origin main` is never pushed directly.
 *
 * Phase 2 (run on `main` after the merge, when package.json already carries
 * the version) resolves the release commit from the version bump (or an
 * explicit `--sha`), waits for its successful main CI run, waits for the
 * Worker deployment whose log proves exactly that CI run, checks the
 * production health endpoint, creates the annotated tag on that commit,
 * pushes it and creates the GitHub Release as a draft.
 *
 * Fail-closed everywhere: a non-green or non-matching step aborts before the
 * tag exists. Re-runs resume: the version files decide the phase, the remote
 * tag decides whether the tag step is done, and the CHANGELOG entry is never
 * duplicated.
 *
 * Usage:
 *   bun run release              # patch bump (default), phase 1
 *   bun run release -- minor     # minor bump
 *   bun run release -- major     # major bump
 *   bun run release -- 2.0.0     # explicit version: phase 1, then phase 2
 *   bun run release -- --dry-run # preview without side effects
 *
 * Env:
 *   Requires `gh` CLI authenticated for GitHub release creation.
 */

import { execFileSync, spawnSync } from "node:child_process";
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
const QUERY_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 30 * 60_000;
const PRODUCTION_LIVE_URL = "https://lyre.hexly.ai/api/live";
const HEALTH_ATTEMPTS = 3;
const HEALTH_RETRY_SECONDS = 5;

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const PROOF_RE = /Resolved release source ([0-9a-f]{40}) run ([0-9]+)/g;

// Workspace package.json files to keep in sync
const WORKSPACE_PACKAGES = [
	pathResolve(PROJECT_ROOT, "apps/web/package.json"),
	pathResolve(PROJECT_ROOT, "apps/api/package.json"),
	pathResolve(PROJECT_ROOT, "packages/api/package.json"),
].filter((p) => existsSync(p));

// ---------------------------------------------------------------------------
// Process execution (argv arrays only; no shell, no string interpolation)
// ---------------------------------------------------------------------------

interface ExecOptions {
	cwd?: string;
	quiet?: boolean;
	timeout?: number;
	dryRun?: boolean;
	inheritAll?: boolean;
}

function display(command: string, args: string[]): string {
	return [command, ...args].join(" ");
}

function exec(command: string, args: string[], opts?: ExecOptions): string {
	if (opts?.dryRun) {
		console.log(`  [dry-run] ${display(command, args)}`);
		return "";
	}
	if (!opts?.quiet) {
		console.log(`  $ ${display(command, args)}`);
	}
	const timeout = opts?.timeout ?? QUERY_TIMEOUT_MS;
	try {
		return execFileSync(command, args, {
			cwd: opts?.cwd ?? PROJECT_ROOT,
			encoding: "utf-8",
			stdio: opts?.inheritAll ? "inherit" : ["pipe", "pipe", "inherit"],
			timeout,
		}).trim();
	} catch (error) {
		const failure = error as Error & { signal?: string | null };
		if (failure.signal === "SIGTERM") {
			failure.message = `Timed out after ${timeout / 1000}s: ${display(command, args)}`;
		}
		throw failure;
	}
}

function execStatus(command: string, args: string[], opts?: ExecOptions): number {
	if (opts?.dryRun) {
		console.log(`  [dry-run] ${display(command, args)}`);
		return 0;
	}
	const result = spawnSync(command, args, {
		cwd: opts?.cwd ?? PROJECT_ROOT,
		encoding: "utf-8",
		stdio: "ignore",
		timeout: opts?.timeout ?? QUERY_TIMEOUT_MS,
	});
	if (result.error) {
		return 1;
	}
	return result.status ?? 1;
}

function sleepSeconds(seconds: number): void {
	spawnSync("sleep", [String(seconds)], { stdio: "ignore" });
}

function fail(message: string, hint?: string): never {
	console.error(`\n❌ ${message}\n`);
	if (hint) {
		console.error(`${hint}\n`);
	}
	process.exit(1);
}

function readJson(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path: string, data: Record<string, unknown>): void {
	writeFileSync(path, `${JSON.stringify(data, null, "\t")}\n`);
}

function rootVersion(): string {
	return String(readJson(PACKAGE_JSON).version ?? "");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function assertSemver(value: string, label: string): void {
	if (!VERSION_RE.test(value)) {
		fail(`${label} "${value}" is not a strict x.y.z version.`);
	}
}

function bumpVersion(current: string, bump: string): string {
	if (bump.includes(".")) {
		if (!VERSION_RE.test(bump)) {
			fail(`Version "${bump}" is not a strict x.y.z version.`);
		}
		return bump;
	}

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
			fail(`Unknown bump type "${bump}"; use major, minor, patch or x.y.z.`);
	}
}

/** Optional explicit release SHA: `--sha=<sha>` (full 40 hex characters). */
function parseShaArgument(args: string[]): string {
	const raw = args.find((a) => a.startsWith("--sha="))?.slice("--sha=".length) ?? "";
	if (!raw) return "";
	if (!SHA_RE.test(raw)) {
		fail(`--sha must be a full 40-character commit SHA, got "${raw}".`);
	}
	return raw;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function gitOut(args: string[], opts?: ExecOptions): string {
	return exec("git", args, opts);
}

function gitSha(ref: string, opts?: ExecOptions): string {
	return gitOut(["rev-parse", ref], { quiet: true, ...opts }).toLowerCase();
}

function currentBranch(): string {
	return gitOut(["rev-parse", "--abbrev-ref", "HEAD"], { quiet: true });
}

function localRefExists(ref: string): boolean {
	return execStatus("git", ["rev-parse", "--q", "--verify", ref], { quiet: true }) === 0;
}

/** Commit a local tag points at; annotated tags are dereferenced. */
function localTagCommit(tag: string): string {
	return gitOut(["rev-list", "-n", "1", `refs/tags/${tag}`], { quiet: true }).toLowerCase();
}

/** Commit a remote tag points at, or "" when the remote has no such tag. */
function remoteTagCommit(tag: string, dryRun: boolean): string {
	const out = exec("git", ["ls-remote", REMOTE, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], {
		quiet: true,
		dryRun,
	});
	let direct = "";
	let peeled = "";
	for (const line of out.split("\n")) {
		const [sha, ref] = line.split(/\s+/);
		if (!sha || !ref) continue;
		if (ref === `refs/tags/${tag}`) direct = sha;
		if (ref === `refs/tags/${tag}^{}`) peeled = sha;
	}
	return (peeled || direct).toLowerCase();
}

function remoteBranchTip(branch: string, dryRun: boolean): string {
	const out = exec("git", ["ls-remote", REMOTE, `refs/heads/${branch}`], {
		quiet: true,
		dryRun,
	});
	return out.split(/\s+/)[0]?.toLowerCase() ?? "";
}

/**
 * Abort if the working tree has uncommitted changes.
 * Prevents accidentally bundling unrelated files into a release commit.
 */
function ensureCleanWorkingTree(): void {
	const status = gitOut(["status", "--porcelain"], { quiet: true });
	if (status) {
		console.error("\n❌ Working tree is dirty. Commit or stash changes before releasing.\n");
		console.error("Uncommitted files:");
		for (const line of status.split("\n")) {
			console.error(`   ${line}`);
		}
		process.exit(1);
	}
}

function ensureGitHubCli(): void {
	if (execStatus("gh", ["--version"], { quiet: true }) !== 0) {
		fail("The GitHub CLI (`gh`) is required to release.");
	}
	if (execStatus("gh", ["auth", "status"], { quiet: true }) !== 0) {
		fail("`gh` is not authenticated.", "   Run `gh auth login` first.\n");
	}
}

/**
 * Refuse to release from a diverged local main: the release branch has to be
 * cut from the current origin/main, and the finishing phase has to run on the
 * merged tip.
 */
function ensureSyncedWithRemote(): void {
	exec("git", ["fetch", REMOTE, RELEASE_BRANCH], { quiet: true });
	if (
		execStatus("git", ["merge-base", "--is-ancestor", `${REMOTE}/${RELEASE_BRANCH}`, "HEAD"]) !== 0
	) {
		fail(
			`Local ${RELEASE_BRANCH} has diverged from ${REMOTE}/${RELEASE_BRANCH}.`,
			`   Sync it first: git pull --rebase ${REMOTE} ${RELEASE_BRANCH}\n`,
		);
	}
}

/**
 * A version whose commit is already on origin/main but which has no tag is an
 * unfinished release. Bumping past it would skip a published version number.
 */
function assertNoSkippedVersion(currentVersion: string, targetVersion: string): void {
	if (currentVersion === targetVersion) return;
	const tag = `v${currentVersion}`;
	if (localRefExists(`refs/tags/${tag}`) || remoteTagCommit(tag, false)) return;
	if (gitSha("HEAD") !== gitSha(`${REMOTE}/${RELEASE_BRANCH}`)) return;
	fail(
		`v${currentVersion} is committed on ${REMOTE} ${RELEASE_BRANCH} but has no tag.`,
		`   Finish that release first:  bun run release -- ${currentVersion}\n` +
			`   A bare "bun run release" would skip v${currentVersion}.\n`,
	);
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
	exec("xcodegen", ["generate"], { dryRun, cwd: pathResolve(PROJECT_ROOT, "apps/macos") });
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
	const lastTag =
		gitOut(["describe", "--tags", "--abbrev=0"], { quiet: true }) ||
		gitOut(["rev-list", "--max-parents=0", "HEAD"], { quiet: true });
	const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
	const rawLog = gitOut(["log", range, "--pretty=format:%s (%h)", "--no-merges"], { quiet: true });

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
	const out = exec(
		"gh",
		[
			"run",
			"list",
			"--workflow",
			workflowFile,
			"--branch",
			RELEASE_BRANCH,
			"--commit",
			sha,
			"--limit",
			"20",
			"--json",
			"databaseId,status,conclusion,event,headBranch,headSha,url",
		],
		{ quiet: true, timeout },
	);
	if (!out.trim()) return [];
	const parsed: unknown = JSON.parse(out);
	return Array.isArray(parsed) ? (parsed as WorkflowRun[]) : [];
}

type WaitOutcome =
	| { status: "accepted"; run: WorkflowRun; detail: string }
	| { status: "pending"; detail: string }
	| { status: "rejected"; detail: string };

interface WaitOptions {
	workflowFile: string;
	sha: string;
	deadline: Deadline;
	evaluate: (runs: WorkflowRun[], remaining: number) => WaitOutcome;
	rejectionHint?: string;
}

/**
 * Block until `evaluate` accepts a workflow run for `sha`.
 *
 * Fails closed: a failed, mismatched or missing run aborts the release before
 * any tag is created, and a result that arrives after the deadline is not
 * accepted.
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
			Math.min(QUERY_TIMEOUT_MS, remaining),
		);
		if (remainingMs(options.deadline) <= 0) {
			fail(
				`Timed out after ${options.deadline.label} waiting for a ${options.workflowFile} run of ${options.sha}.`,
				`   The result arrived after the deadline and was not accepted. No tag was created.\n`,
			);
		}

		const outcome = options.evaluate(runs, remainingMs(options.deadline));
		if (outcome.status === "accepted") {
			if (remainingMs(options.deadline) <= 0) {
				fail(
					`Timed out after ${options.deadline.label} waiting for a ${options.workflowFile} run of ${options.sha}.`,
					`   The proof arrived after the deadline and was not accepted. No tag was created.\n`,
				);
			}
			console.log(`   ${options.workflowFile} ${outcome.detail}: ${outcome.run.url}`);
			return outcome.run;
		}
		if (outcome.status === "rejected") {
			fail(
				`${options.workflowFile}: ${outcome.detail}`,
				options.rejectionHint ?? `   No tag was created.\n`,
			);
		}
		console.log(`   ${outcome.detail}`);

		const sleepSecondsToUse = Math.min(
			POLL_SECONDS,
			Math.ceil(remainingMs(options.deadline) / 1000),
		);
		if (sleepSecondsToUse <= 0) continue;
		sleepSeconds(sleepSecondsToUse);
	}
}

/**
 * Proof that a deployment run resolved exactly the given CI run and commit.
 * The release-source action prints the proven SHA and run ID into its log;
 * both are compared exactly, never by substring.
 */
function deploymentProvesRun(
	deployment: WorkflowRun,
	sha: string,
	ciRunId: number,
	timeout: number,
): { ok: boolean; detail: string } {
	let log: string;
	try {
		log = exec("gh", ["run", "view", String(deployment.databaseId), "--log"], {
			quiet: true,
			timeout,
		});
	} catch (error) {
		return { ok: false, detail: `log could not be read (${(error as Error).message})` };
	}
	let first: string | null = null;
	for (const match of log.matchAll(PROOF_RE)) {
		const provenSha = match[1] ?? "";
		const provenRun = match[2] ?? "";
		if (first === null) first = `Resolved release source ${provenSha} run ${provenRun}`;
		if (provenSha === sha && provenRun === String(ciRunId)) {
			return { ok: true, detail: `proved CI run ${provenRun} on ${provenSha.slice(0, 7)}` };
		}
	}
	return {
		ok: false,
		detail: first
			? `proved "${first}" instead of CI run ${ciRunId} on ${sha.slice(0, 7)}`
			: "contains no release-source proof",
	};
}

// ---------------------------------------------------------------------------
// Release steps
// ---------------------------------------------------------------------------

/**
 * Confirm the production Worker answers with the released version.
 * An HTTP answer that is not 200 is a deployment fault and is fatal; only a
 * request that could not be completed at all (DNS, timeout, refused) counts
 * as "unreachable", and even then the deployment run's own verify-command
 * remains the recorded evidence.
 */
function verifyProductionHealth(version: string): void {
	const bodyFile = `/tmp/lyre-live-${version}.json`;
	for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++) {
		let code: string;
		try {
			code = exec(
				"curl",
				["-sS", "--max-time", "20", "-o", bodyFile, "-w", "%{http_code}", PRODUCTION_LIVE_URL],
				{ quiet: true, timeout: 30_000 },
			);
		} catch {
			console.log(`   ${PRODUCTION_LIVE_URL} unreachable (attempt ${attempt}/${HEALTH_ATTEMPTS}).`);
			sleepSeconds(HEALTH_RETRY_SECONDS);
			continue;
		}
		if (code !== "200") {
			fail(
				`${PRODUCTION_LIVE_URL} answered HTTP ${code}; the deployment is unhealthy.`,
				`   No tag was created. Fix the deployment, then re-run:\n     bun run release -- ${version}\n`,
			);
		}
		let reported = "";
		try {
			reported = String(
				(JSON.parse(readFileSync(bodyFile, "utf-8")) as { version?: string }).version ?? "",
			);
		} catch {
			fail(
				`${PRODUCTION_LIVE_URL} returned HTTP 200 with a body that is not the live JSON.`,
				`   No tag was created.\n`,
			);
		}
		if (reported !== version) {
			fail(
				`${PRODUCTION_LIVE_URL} reports v${reported || "?"} but the release is v${version}.`,
				`   The deployment does not match the released version. No tag was created.\n`,
			);
		}
		console.log(`   ${PRODUCTION_LIVE_URL} reports v${reported}.`);
		return;
	}
	console.log(
		`   Could not reach ${PRODUCTION_LIVE_URL} locally; the deployment run's own verify-command is the recorded evidence.`,
	);
}

/**
 * Create the annotated tag on the release commit, or prove that an existing
 * local and remote tag points at exactly that commit.
 */
function ensureTag(version: string, sha: string, dryRun: boolean): "created" | "already-pushed" {
	const tag = `v${version}`;
	if (localRefExists(`refs/tags/${tag}`)) {
		const local = localTagCommit(tag);
		if (local !== sha) {
			fail(
				`Local tag ${tag} points at ${local}, not at the release commit ${sha}.`,
				`   Move or delete the stale tag before releasing. No tag was pushed.\n`,
			);
		}
		console.log(`   Local tag ${tag} already points at the release commit.`);
	} else {
		exec("git", ["tag", "-a", tag, sha, "-m", tag], { dryRun });
	}

	const remote = remoteTagCommit(tag, dryRun);
	if (remote) {
		if (remote !== sha) {
			fail(
				`Remote tag ${tag} points at ${remote}, not at the release commit ${sha}.`,
				`   Move or delete the remote tag before releasing. No tag was pushed.\n`,
			);
		}
		console.log(
			`   Remote tag ${tag} already points at the release commit — the tag step is done.`,
		);
		return "already-pushed";
	}
	exec("git", ["push", REMOTE, tag], { dryRun, timeout: HOOK_TIMEOUT_MS, inheritAll: true });
	return "created";
}

interface ReleaseView {
	isDraft: boolean;
	url: string;
}

function viewRelease(tag: string): ReleaseView | null {
	try {
		const out = exec("gh", ["release", "view", tag, "--json", "isDraft,url"], { quiet: true });
		return JSON.parse(out) as ReleaseView;
	} catch {
		return null;
	}
}

/**
 * Create the GitHub Release as a draft, and report precisely which of the
 * three states is present: a draft, a published release, or only the tag.
 */
function ensureGitHubRelease(
	version: string,
	notes: string,
	dryRun: boolean,
	tagState: string,
): void {
	const tag = `v${version}`;
	if (!dryRun) {
		const view = viewRelease(tag);
		if (view) {
			if (view.isDraft) {
				console.log(`   Draft release already exists: ${view.url}`);
				console.log(
					`   Attach the macOS DMG and SHA256SUMS, then publish it (docs/12-agent-operations.md).`,
				);
			} else {
				console.log(`   Published release already exists: ${view.url} — nothing to create.`);
			}
			return;
		}
	}
	if (tagState === "already-pushed") {
		console.log(`   Only the remote tag exists so far — creating the draft release.`);
	}
	const notesFile = `/tmp/lyre-release-notes-${version}.md`;
	if (!dryRun) {
		writeFileSync(notesFile, notes);
	}
	exec("gh", ["release", "create", tag, "--draft", "--title", tag, "--notes-file", notesFile], {
		dryRun,
	});
	console.log(`   Draft release created. Attach the macOS DMG and SHA256SUMS, then publish it.`);
}

/**
 * Phase 1: commit the version bump on the release branch and push the branch.
 * `origin main` is never pushed directly; the PR carries the CI evidence.
 */
function prepareReleaseBranch(targetVersion: string, dryRun: boolean): void {
	const branch = `chore/release-v${targetVersion}`;
	const remoteTip = remoteBranchTip(branch, dryRun);

	if (localRefExists(`refs/heads/${branch}`)) {
		console.log(`\n5️⃣  The release branch ${branch} already exists — completing it.`);
		exec("git", ["switch", branch], { dryRun });
		if (!dryRun && rootVersion() !== targetVersion) {
			fail(
				`Branch ${branch} carries v${rootVersion()}, not v${targetVersion}.`,
				`   Delete the stale branch or pass the matching version.\n`,
			);
		}
	} else {
		console.log(`\n5️⃣  Committing the release changes on ${branch}...`);
		exec("git", ["switch", "-c", branch], { dryRun });
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
		exec("git", ["add", ...releaseFiles], { dryRun });
		exec("git", ["commit", "-m", `chore: release v${targetVersion}`], {
			dryRun,
			timeout: HOOK_TIMEOUT_MS,
			inheritAll: true,
		});
	}

	const localTip = dryRun ? "<branch-tip>" : gitSha("HEAD");
	if (remoteTip && remoteTip === localTip) {
		console.log(`   ${REMOTE}/${branch} is already up to date.`);
	} else {
		console.log(`\n6️⃣  Pushing ${branch} through the normal hooks...`);
		try {
			exec("git", ["push", "-u", REMOTE, branch], {
				dryRun,
				timeout: HOOK_TIMEOUT_MS,
				inheritAll: true,
			});
		} catch (error) {
			fail(
				`Pushing ${branch} failed: ${(error as Error).message}`,
				`   The prepared branch is kept. Fix the cause and re-run:\n     bun run release -- ${targetVersion}\n`,
			);
		}
	}

	console.log(`\n✅ Release branch ${branch} is ready.`);
	console.log(
		`\n   ${RELEASE_BRANCH} is ruleset-protected; merge the release commit through a pull request:\n`,
	);
	console.log(
		`     gh pr create --base ${RELEASE_BRANCH} --head ${branch} --title "chore: release v${targetVersion}" --body "Release v${targetVersion}"`,
	);
	console.log(`     # merge the PR without squashing so the release commit keeps its SHA\n`);
	console.log(`   After the merge, finish the release:\n`);
	console.log(`     git switch ${RELEASE_BRANCH}`);
	console.log(
		`     git fetch ${REMOTE} ${RELEASE_BRANCH} && git reset --hard ${REMOTE}/${RELEASE_BRANCH}`,
	);
	console.log(`     bun run release -- ${targetVersion}\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
	const args = process.argv.slice(2);
	const dryRun = args.includes("--dry-run");
	const bumpArg =
		args.find((a) => a !== "--dry-run" && a !== "--" && !a.startsWith("--sha")) ?? "patch";
	const explicitSha = parseShaArgument(args);

	const currentVersion = rootVersion();
	assertSemver(currentVersion, "package.json version");
	const targetVersion = bumpVersion(currentVersion, bumpArg);
	assertSemver(targetVersion, "target version");

	const branch = dryRun ? RELEASE_BRANCH : currentBranch();
	const releaseBranchName = `chore/release-v${targetVersion}`;
	const finishing = currentVersion === targetVersion;

	console.log(
		`\n📦 Release: v${currentVersion} → v${targetVersion}${dryRun ? " (dry-run)" : ""}\n`,
	);
	console.log(
		finishing
			? `   Finishing v${targetVersion}: the version is already committed.\n`
			: `   Preparing v${targetVersion}: the version bump goes through a release branch and a PR.\n`,
	);

	if (branch !== RELEASE_BRANCH && branch !== releaseBranchName) {
		fail(
			`Releases run from '${RELEASE_BRANCH}' (or the release branch '${releaseBranchName}'), current branch is '${branch}'.`,
			`   Switch first: git switch ${RELEASE_BRANCH}\n`,
		);
	}

	// 0. Pre-flight: clean tree, synced main, authenticated gh, no skipped version
	if (!dryRun) {
		ensureCleanWorkingTree();
		ensureGitHubCli();
		ensureSyncedWithRemote();
		assertNoSkippedVersion(currentVersion, targetVersion);
	}

	// Already on the release branch: complete it (push it, then hand over to
	// the pull request), whatever the version files say.
	if (branch === releaseBranchName) {
		prepareReleaseBranch(targetVersion, dryRun);
		return;
	}

	// Phase 1: prepare the release branch and hand over to the pull request.
	if (!finishing) {
		if (!dryRun && gitSha("HEAD") !== gitSha(`${REMOTE}/${RELEASE_BRANCH}`)) {
			fail(
				`Local ${RELEASE_BRANCH} is ahead of ${REMOTE}/${RELEASE_BRANCH}.`,
				`   A release commit must reach ${RELEASE_BRANCH} through a pull request. Keep it on a\n` +
					`   branch and move local ${RELEASE_BRANCH} back:\n` +
					`     git branch ${releaseBranchName}\n` +
					`     git reset --hard ${REMOTE}/${RELEASE_BRANCH}\n` +
					`     git switch ${releaseBranchName}\n` +
					`   Then re-run: bun run release -- ${targetVersion}\n`,
			);
		}

		// 1. Bump version in root package.json
		console.log("1️⃣  Bumping versions...");
		const rootPkg = readJson(PACKAGE_JSON);
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
		exec("bun", ["install"], { dryRun, timeout: HOOK_TIMEOUT_MS });

		// 4. Generate changelog
		console.log("\n4️⃣  Generating CHANGELOG...");
		const existingEntry = findChangelogEntry(targetVersion);
		if (existingEntry) {
			console.log(`   CHANGELOG entry for v${targetVersion} already exists — keeping it.`);
		} else {
			const entry = buildChangelogEntry(targetVersion);
			if (entry) {
				console.log(entry);
				if (!dryRun) {
					prependChangelog(entry);
				}
			} else {
				console.log("   No commits found since last tag.");
			}
		}

		// 5. Commit on the release branch, 6. push it, then hand over to the PR.
		prepareReleaseBranch(targetVersion, dryRun);
		return;
	}

	// Phase 2: finish the release on the merged main tip.
	if (branch !== RELEASE_BRANCH) {
		fail(
			`Finishing runs on '${RELEASE_BRANCH}', current branch is '${branch}'.`,
			`   Merge the release pull request, then:\n` +
				`     git switch ${RELEASE_BRANCH}\n` +
				`     git fetch ${REMOTE} ${RELEASE_BRANCH} && git reset --hard ${REMOTE}/${RELEASE_BRANCH}\n` +
				`     bun run release -- ${targetVersion}\n`,
		);
	}

	// 1. Resolve the release commit deterministically.
	console.log("1️⃣  Resolving the release commit...");
	const head = gitSha("HEAD");
	if (!dryRun && head !== gitSha(`${REMOTE}/${RELEASE_BRANCH}`)) {
		fail(
			`The release commit ${head.slice(0, 7)} is not on ${REMOTE} ${RELEASE_BRANCH}.`,
			`   Merge the release pull request, sync local ${RELEASE_BRANCH}, then re-run:\n` +
				`     bun run release -- ${targetVersion}\n`,
		);
	}
	if (explicitSha && explicitSha !== head) {
		fail(
			`--sha ${explicitSha} is not the current ${RELEASE_BRANCH} tip ${head}.`,
			`   The continuous deployment only proves the ${RELEASE_BRANCH} tip; pass the tip SHA or omit --sha.\n`,
		);
	}
	const releaseSha = head;

	const bumpCommit = findVersionBumpCommit(targetVersion);
	if (!bumpCommit) {
		fail(
			`No commit found that sets package.json to v${targetVersion}.`,
			`   Pass the release commit explicitly: bun run release -- ${targetVersion} --sha <full-sha>\n`,
		);
	}
	console.log(
		`   Version v${targetVersion} was set by ${bumpCommit.slice(0, 7)}; releasing the ${RELEASE_BRANCH} tip ${releaseSha.slice(0, 7)}.`,
	);

	let notes = findChangelogEntry(targetVersion);
	if (!notes) {
		notes = buildChangelogEntry(targetVersion);
		console.log(
			`   CHANGELOG.md has no entry for v${targetVersion}; the release notes are built from the commits since the last tag.`,
		);
	}

	// 2. Wait for the main CI run of the release commit.
	console.log("\n2️⃣  Waiting for main CI to succeed...");
	let ciRunId = 0;
	if (dryRun) {
		console.log(`   [dry-run] wait for a successful ${CI_WORKFLOW_FILE} run of ${releaseSha}`);
	} else {
		const ciRun = waitForWorkflowRun({
			workflowFile: CI_WORKFLOW_FILE,
			sha: releaseSha,
			deadline: createDeadline(CI_TIMEOUT_MINUTES, `${CI_TIMEOUT_MINUTES} min`),
			evaluate: (runs) => {
				const candidate = runs
					.filter(
						(run) =>
							run.event === "push" &&
							run.headBranch === RELEASE_BRANCH &&
							run.headSha === releaseSha,
					)
					.sort((a, b) => b.databaseId - a.databaseId)[0];
				if (!candidate) {
					return {
						status: "pending",
						detail: `waiting for the CI run of ${releaseSha.slice(0, 7)} to appear`,
					};
				}
				if (candidate.status !== "completed") {
					return { status: "pending", detail: `CI still running: ${candidate.url}` };
				}
				if (candidate.conclusion !== "success") {
					return {
						status: "rejected",
						detail: `CI run ${candidate.url} concluded '${candidate.conclusion}'`,
					};
				}
				return { status: "accepted", run: candidate, detail: "succeeded" };
			},
			rejectionHint: `   Fix the failing CI run, then re-run:\n     bun run release -- ${targetVersion}\n`,
		});
		ciRunId = ciRun.databaseId;
		console.log(`   CI run ${ciRunId} proved ${releaseSha.slice(0, 7)}.`);
	}

	// 3. Wait for the Worker deployment that proves exactly that CI run.
	console.log("\n3️⃣  Waiting for the Worker deployment to succeed...");
	if (dryRun) {
		console.log(`   [dry-run] wait for a successful ${DEPLOY_WORKFLOW_FILE} run of ${releaseSha}`);
	} else {
		waitForWorkflowRun({
			workflowFile: DEPLOY_WORKFLOW_FILE,
			sha: releaseSha,
			deadline: createDeadline(DEPLOY_TIMEOUT_MINUTES, `${DEPLOY_TIMEOUT_MINUTES} min`),
			evaluate: (runs, remaining) => {
				const candidates = runs
					.filter((run) => run.event === "workflow_run" && run.headSha === releaseSha)
					.sort((a, b) => b.databaseId - a.databaseId);
				if (candidates.length === 0) {
					return {
						status: "pending",
						detail: `waiting for the deployment run of ${releaseSha.slice(0, 7)} to appear`,
					};
				}
				const failures: string[] = [];
				let running = "";
				for (const deployment of candidates) {
					if (deployment.status !== "completed") {
						running = deployment.url;
						continue;
					}
					if (deployment.conclusion !== "success") {
						failures.push(`run ${deployment.databaseId} concluded '${deployment.conclusion}'`);
						continue;
					}
					const proof = deploymentProvesRun(
						deployment,
						releaseSha,
						ciRunId,
						Math.min(QUERY_TIMEOUT_MS, remaining),
					);
					if (proof.ok) {
						return { status: "accepted", run: deployment, detail: proof.detail };
					}
					failures.push(`run ${deployment.databaseId} (${deployment.url}) ${proof.detail}`);
				}
				if (running) {
					return { status: "pending", detail: `deployment still running: ${running}` };
				}
				if (failures.length > 0) {
					return {
						status: "rejected",
						detail: `no deployment run proves CI run ${ciRunId} on ${releaseSha.slice(0, 7)}: ${failures.join("; ")}`,
					};
				}
				return {
					status: "pending",
					detail: `waiting for the deployment run of ${releaseSha.slice(0, 7)}`,
				};
			},
			rejectionHint:
				`   The deployment must prove CI run ${ciRunId} on ${releaseSha.slice(0, 7)}.\n` +
				`   Fix the deployment, then re-run:\n     bun run release -- ${targetVersion}\n`,
		});
	}

	// 4. Confirm the production Worker answers with the released version.
	console.log("\n4️⃣  Checking the production health endpoint...");
	if (dryRun) {
		console.log(`   [dry-run] check ${PRODUCTION_LIVE_URL} reports v${targetVersion}`);
	} else {
		verifyProductionHealth(targetVersion);
	}

	// 5. Tag and push the tag — only now, with green CI and a live deployment.
	console.log(`\n5️⃣  Tagging v${targetVersion} on ${releaseSha.slice(0, 7)}...`);
	const tagState = ensureTag(targetVersion, releaseSha, dryRun);

	// 6. GitHub release — a draft until the DMG and SHA256SUMS are attached.
	console.log("\n6️⃣  Creating the GitHub release draft...");
	ensureGitHubRelease(targetVersion, notes || `Release v${targetVersion}`, dryRun, tagState);

	console.log(`\n✅ Released v${targetVersion}!`);
}

/**
 * The commit that introduced `"version": "<version>"` in the root
 * package.json — the deterministic anchor of a resumed release.
 */
function findVersionBumpCommit(version: string): string {
	const out = exec(
		"git",
		["log", `-S"version": "${version}"`, "--format=%H", "-n", "1", "--", "package.json"],
		{ quiet: true },
	);
	const sha = out.split("\n")[0]?.toLowerCase() ?? "";
	if (!SHA_RE.test(sha)) return "";
	if (execStatus("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { quiet: true }) !== 0) {
		return "";
	}
	return sha;
}

main();
