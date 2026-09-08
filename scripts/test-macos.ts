import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";

export function nativeTestEnvironment(
	inherited: NodeJS.ProcessEnv,
	live: boolean,
): NodeJS.ProcessEnv {
	if (live && inherited.LYRE_RUN_LIVE_RECORDING !== "1") {
		throw new Error("Live audio capture requires LYRE_RUN_LIVE_RECORDING=1 and --live.");
	}
	const recording = live ? "1" : "0";
	return {
		...inherited,
		LYRE_TEST_HOST: "1",
		LYRE_RUN_LIVE_RECORDING: recording,
		TEST_RUNNER_LYRE_TEST_HOST: "1",
		TEST_RUNNER_LYRE_RUN_LIVE_RECORDING: recording,
	};
}

export async function runNativeTests(args: string[]): Promise<number> {
	if (args.length > 1 || (args.length === 1 && args[0] !== "--live")) {
		throw new Error("Usage: bun run test:macos [--live]");
	}
	const environment = nativeTestEnvironment(process.env, args[0] === "--live");
	const root = resolve(import.meta.dirname, "..");
	const resultsRoot = resolve(root, "test-results/macos");
	await mkdir(resultsRoot, { recursive: true });
	const directory = await mkdtemp(resolve(resultsRoot, "run-"));
	const derivedData = resolve(directory, "DerivedData");
	const resultBundle = resolve(directory, "Tests.xcresult");
	console.info(`Native test results: ${resultBundle}`);
	let succeeded = false;
	try {
		const exitCode = await new Promise<number>((resolveExit, reject) => {
			const child = spawn(
				"xcodebuild",
				[
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
					"-derivedDataPath",
					derivedData,
					"-resultBundlePath",
					resultBundle,
					"CODE_SIGN_IDENTITY=-",
					"CODE_SIGNING_REQUIRED=NO",
					"CODE_SIGNING_ALLOWED=NO",
					`LYRE_RUN_LIVE_RECORDING=${environment.LYRE_RUN_LIVE_RECORDING}`,
				],
				{
					cwd: resolve(root, "apps/macos"),
					env: environment,
					stdio: "inherit",
					detached: true,
				},
			);
			let interrupted: NodeJS.Signals | undefined;
			const forwardSignal = (signal: NodeJS.Signals) => {
				interrupted = signal;
				if (child.pid) {
					try {
						// Stop the xcodebuild process group and await its shutdown.
						process.kill(-child.pid, signal);
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
					}
				}
			};
			const onInterrupt = () => forwardSignal("SIGINT");
			const onTerminate = () => forwardSignal("SIGTERM");
			const cleanup = () => {
				process.off("SIGINT", onInterrupt);
				process.off("SIGTERM", onTerminate);
			};
			process.on("SIGINT", onInterrupt);
			process.on("SIGTERM", onTerminate);
			child.once("error", (error) => {
				cleanup();
				reject(error);
			});
			child.once("close", (code) => {
				cleanup();
				resolveExit(interrupted ? (interrupted === "SIGINT" ? 130 : 143) : (code ?? 1));
			});
		});
		succeeded = exitCode === 0;
		return exitCode;
	} finally {
		// Preserve xctestrun and build diagnostics after failure or interruption.
		// Successful runs retain their result bundle and remove only their own DD.
		if (succeeded) await rm(derivedData, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	process.exitCode = await runNativeTests(process.argv.slice(2));
}
