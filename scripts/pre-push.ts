#!/usr/bin/env bun

/**
 * Run pre-push gates in parallel:
 *   G2: gate:deps          (dependency vulnerability scan)
 *   G1: lint               (web + api lint)
 *   G1: typecheck          (web + worker + api)
 *   L1: test:coverage      (vitest unit + coverage)
 *       web:build          (production build)
 *   L2: test:e2e           (wrangler dev --env test, longest)  ← live
 *   macOS L1: xcodebuild test (LyreTests scheme)
 *   macOS G1: swiftlint    (--strict)
 *
 * Each task's stdout/stderr is buffered and replayed on completion,
 * except L2 (live) which streams in real time (longest task, includes
 * wrangler dev lifecycle logs). A summary table prints at the end.
 */

import { resolve } from "node:path";
import { type Subprocess, spawn } from "bun";

const ROOT = resolve(import.meta.dirname, "..");
const MACOS_DIR = resolve(ROOT, "apps/macos");

interface Step {
	name: string;
	cmd: string[];
	cwd?: string;
	/** When true, inherit stdio so output streams live. */
	live?: boolean;
}

const STEPS: Step[] = [
	{ name: "gate:deps", cmd: ["bun", "run", "gate:deps"] },
	{ name: "lint", cmd: ["bun", "run", "lint"] },
	{ name: "typecheck", cmd: ["bun", "run", "typecheck"] },
	{ name: "test:coverage", cmd: ["bun", "run", "test:coverage"] },
	{ name: "web:build", cmd: ["bun", "run", "web:build"] },
	{ name: "test:e2e", cmd: ["bun", "run", "test:e2e"], live: true },
	{
		name: "macos xcodebuild",
		cmd: [
			"xcodebuild",
			"test",
			"-project",
			"Lyre.xcodeproj",
			"-scheme",
			"LyreTests",
			"-configuration",
			"Debug",
			"-destination",
			"platform=macOS",
			"-quiet",
			// Ad-hoc signing for the local test bundle so dev machines without
			// the production Apple Dev cert can still run the gate. Release
			// (release.ts) does not pass these overrides and continues to use
			// the team-managed cert.
			"CODE_SIGN_IDENTITY=-",
			"CODE_SIGNING_REQUIRED=NO",
			"CODE_SIGNING_ALLOWED=NO",
		],
		cwd: MACOS_DIR,
	},
	{
		name: "macos swiftlint",
		cmd: ["swiftlint", "lint", "--strict", "Lyre/", "LyreTests/"],
		cwd: MACOS_DIR,
	},
];

interface Outcome {
	name: string;
	ok: boolean;
	ms: number;
	output?: string;
}

async function run(step: Step): Promise<Outcome> {
	const start = performance.now();
	const proc: Subprocess = spawn(step.cmd, {
		cwd: step.cwd,
		stdout: step.live ? "inherit" : "pipe",
		stderr: step.live ? "inherit" : "pipe",
	});
	let output = "";
	if (!step.live) {
		const [out, err] = await Promise.all([
			new Response(proc.stdout as ReadableStream).text(),
			new Response(proc.stderr as ReadableStream).text(),
		]);
		output = (out + err).trim();
	}
	const code = await proc.exited;
	return { name: step.name, ok: code === 0, ms: performance.now() - start, output };
}

const results = await Promise.all(STEPS.map(run));

let failed = false;
console.log("\n──────── pre-push summary ────────");
for (const r of results) {
	const status = r.ok ? "✅" : "❌";
	console.log(`${status} ${r.name} (${Math.round(r.ms)}ms)`);
	if (!r.ok && r.output) {
		console.log(r.output);
		failed = true;
	} else if (!r.ok) {
		failed = true;
	}
}

if (failed) process.exit(1);
