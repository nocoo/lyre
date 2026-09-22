import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

DEADLINE = time.monotonic() + 480
ENV = {key: value for key, value in os.environ.items() if key in (
    "PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "DEVELOPER_DIR", "SDKROOT",
)}
ENV.setdefault("DEVELOPER_DIR", "/Applications/Xcode.app/Contents/Developer")
ENV["CI"] = "1"
ENV["NEXT_TELEMETRY_DISABLED"] = "1"


def interrupted(signum, _frame):
    raise SystemExit(128 + signum)


def run(args, cwd, capture=False):
    print("pre-commit: " + " ".join(map(str, args)), flush=True)
    environment = dict(ENV)
    if args[0] in ("git", "gitleaks"):
        environment.update({k: v for k, v in os.environ.items() if k.startswith("GIT_")})
    child = subprocess.Popen(args, cwd=cwd, env=environment, start_new_session=True,
                             stdout=subprocess.PIPE if capture else None, text=True)
    try:
        output, _ = child.communicate(timeout=max(0.01, DEADLINE - time.monotonic()))
        if child.returncode:
            raise subprocess.CalledProcessError(child.returncode, args)
        return output
    finally:
        # Descendants can outlive the command, including after cancellation.
        try:
            os.killpg(child.pid, signal.SIGTERM)
            child.wait(timeout=3)
        except ProcessLookupError:
            pass
        except subprocess.TimeoutExpired:
            pass
        finally:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()


def link_dependencies(source, target, root, snapshot):
    root = root.resolve()
    snapshot = snapshot.resolve()
    if not source.is_dir():
        raise RuntimeError(f"Missing dependencies: {source}")
    target.mkdir(parents=True, exist_ok=True)
    for entry in source.iterdir():
        if entry.name.startswith(".") and entry.name not in (".bin", ".bun"):
            continue
        destination = target / entry.name
        if entry.name.startswith("@") and entry.is_dir():
            link_dependencies(entry, destination, root, snapshot)
            continue
        resolved = entry.resolve()
        if resolved.is_relative_to(root) and "node_modules" not in resolved.relative_to(root).parts:
            resolved = snapshot / resolved.relative_to(root)
        destination.symlink_to(resolved, target_is_directory=entry.is_dir())


def check_tests(path):
    report = json.loads(path.read_text())
    if not report.get("success") or not report.get("numTotalTests"):
        raise RuntimeError("Missing successful nonempty unit-test report")
    if report.get("numPendingTests", 0) or report.get("numTodoTests", 0):
        raise RuntimeError("Required unit tests were skipped")


def check_native(path, target_name, line_floor, function_floor):
    report = json.loads(path)
    target = next(t for t in report["targets"] if t["name"] == target_name)
    functions = [f for source in target["files"] for f in source["functions"]]
    if not target["executableLines"] or not functions:
        raise RuntimeError("Empty native coverage report")
    lines = 100 * target["coveredLines"] / target["executableLines"]
    covered = sum(f["executionCount"] > 0 for f in functions)
    percent = 100 * covered / len(functions)
    print(f"Native coverage: lines={lines:.2f}%, functions={percent:.2f}%; "
          "statements/branches unavailable in Swift toolchain", flush=True)
    if lines < line_floor or percent < function_floor:
        raise RuntimeError("Native coverage regressed below interim floors; S target remains 95%")


def check_native_tests(result, native, allowed_skips):
    report = json.loads(run(["xcrun", "xcresulttool", "get", "test-results", "summary",
                             "--path", str(result)], native, True))
    if report.get("result") != "Passed" or not report.get("passedTests") or report.get("runtimeWarnings"):
        raise RuntimeError("Native tests failed, were empty, or produced runtime warnings")
    tree = json.loads(run(["xcrun", "xcresulttool", "get", "test-results", "tests",
                           "--path", str(result)], native, True))
    def visit(node):
        if isinstance(node, dict):
            if node.get("nodeType") == "Test Case" and node.get("result") == "Skipped":
                if node.get("nodeIdentifier") not in allowed_skips:
                    raise RuntimeError(f"Required native test skipped: {node.get('name')}")
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)
    visit(tree)


def main():
    for name in TOOLS:
        if shutil.which(name, path=ENV["PATH"]) is None:
            raise RuntimeError(f"Missing required tool: {name}")
    root = Path(run(["git", "rev-parse", "--show-toplevel"], Path.cwd(), True).strip())
    with tempfile.TemporaryDirectory(prefix=PREFIX) as temporary:
        snapshot = Path(temporary) / "source"
        snapshot.mkdir()
        run(["git", "checkout-index", "--all", "--force", f"--prefix={snapshot}/"], root)
        for relative in DEPENDENCIES:
            link_dependencies(root / relative, snapshot / relative, root, snapshot)
        run([sys.executable, "-B", "scripts/test_pre_commit.py"], snapshot)
        checks(root, snapshot, Path(temporary))


TOOLS = ("git", "bun", "node", "gitleaks", "swiftlint", "xcodebuild", "xcrun")
PREFIX = "lyre-l1-"
DEPENDENCIES = ("node_modules", "apps/api/node_modules", "apps/web/node_modules", "packages/api/node_modules")


def checks(root, snapshot, output):
    run(["gitleaks", "protect", "--staged", "--no-banner",
         "--config", str(snapshot / ".gitleaks.toml")], root)
    run(["bun", "run", "lint"], snapshot)
    run(["bun", "run", "typecheck"], snapshot)
    report = output / "tests.json"
    run(["bun", "run", "test:coverage", "--allowOnly=false", "--reporter=default",
         "--reporter=json", f"--outputFile={report}"], snapshot)
    check_tests(report)
    native = snapshot / "apps/macos"
    run(["swiftlint", "lint", "--strict", "--cache-path", str(output / "swiftlint"),
         "Lyre/", "LyreTests/"], native)
    result = output / "Tests.xcresult"
    ENV.update(LYRE_TEST_HOST="1", LYRE_RUN_LIVE_RECORDING="0",
               TEST_RUNNER_LYRE_TEST_HOST="1", TEST_RUNNER_LYRE_RUN_LIVE_RECORDING="0")
    run(["xcodebuild", "test", "-project", "Lyre.xcodeproj", "-scheme", "LyreTests",
         "-configuration", "Debug", "-destination", f"platform=macOS,arch={os.uname().machine}", "-quiet",
         "-derivedDataPath", str(output / "DerivedData"), "-resultBundlePath", str(result),
         "-enableCodeCoverage", "YES", "CODE_SIGN_IDENTITY=-", "CODE_SIGNING_REQUIRED=NO",
         "CODE_SIGNING_ALLOWED=NO", "SWIFT_TREAT_WARNINGS_AS_ERRORS=YES",
         "LYRE_RUN_LIVE_RECORDING=0"], native)
    check_native_tests(result, native, {"RecordingE2ETests/recordAndProduceM4AFile()", "RecordingE2ETests/cannotStartTwice()", "RecordingE2ETests/outputFileHasExpectedName()"})
    coverage = run(["xcrun", "xccov", "view", "--report", "--json", str(result)], native, True)
    check_native(coverage, "Lyre.app", 33, 39)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    try:
        main()
    except (OSError, ValueError, KeyError, StopIteration, RuntimeError,
            subprocess.SubprocessError) as error:
        print(f"pre-commit failed: {error}", file=sys.stderr)
        sys.exit(1)
