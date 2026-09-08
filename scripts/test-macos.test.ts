import { describe, expect, it } from "vitest";
import { nativeTestEnvironment } from "./test-macos";

describe("native test recording opt-in", () => {
	it("ordinary hooks override inherited live flags and preserve the toolchain", () => {
		const environment = nativeTestEnvironment(
			{
				LYRE_TEST_HOST: "0",
				TEST_RUNNER_LYRE_TEST_HOST: "0",
				LYRE_RUN_LIVE_RECORDING: "1",
				TEST_RUNNER_LYRE_RUN_LIVE_RECORDING: "1",
				DEVELOPER_DIR: "/fixture/Xcode/Developer",
			},
			false,
		);
		expect(environment.LYRE_TEST_HOST).toBe("1");
		expect(environment.TEST_RUNNER_LYRE_TEST_HOST).toBe("1");
		expect(environment.LYRE_RUN_LIVE_RECORDING).toBe("0");
		expect(environment.TEST_RUNNER_LYRE_RUN_LIVE_RECORDING).toBe("0");
		expect(environment.DEVELOPER_DIR).toBe("/fixture/Xcode/Developer");
	});

	it.each([undefined, "", "0", "true"])("live mode rejects confirmation %s", (value) => {
		expect(() => nativeTestEnvironment({ LYRE_RUN_LIVE_RECORDING: value }, true)).toThrow(
			"requires LYRE_RUN_LIVE_RECORDING=1 and --live",
		);
	});

	it("explicit live mode forwards its confirmation to the test host", () => {
		const environment = nativeTestEnvironment({ LYRE_RUN_LIVE_RECORDING: "1" }, true);
		expect(environment.LYRE_RUN_LIVE_RECORDING).toBe("1");
		expect(environment.TEST_RUNNER_LYRE_RUN_LIVE_RECORDING).toBe("1");
		expect(environment.TEST_RUNNER_LYRE_TEST_HOST).toBe("1");
	});
});
