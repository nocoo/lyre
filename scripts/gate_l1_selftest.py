#!/usr/bin/env python3
"""Repeatable L1 gate self-test: web-lane negative probes, control, and timing.

Uses a detached worktree, real bun/biome/vitest/gitleaks runners, and the same
snapshot wiring as scripts/pre-commit.py. Native xcodebuild probes are limited
to gate unit tests (scripts/test_pre_commit.py) on non-macOS hosts.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

spec = __import__("importlib.util").util.spec_from_file_location(
    "gate", Path(__file__).with_name("pre-commit.py"))
gate = __import__("importlib.util").util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(gate)

PROBE_TEST = ROOT / "packages/api/src/__tests__/l1-gate-probe.test.ts"
VITEST_CONFIG = ROOT / "vitest.config.ts"
UTILS_TS = ROOT / "apps/web/src/lib/utils.ts"


@dataclass
class ProbeResult:
    name: str
    expected_reject: bool
    rejected: bool
    exit_code: int | None
    detail: str = ""


@dataclass
class SelfTestReport:
    host: str
    probes: list[ProbeResult] = field(default_factory=list)
    unit_tests_ok: bool = False
    missing_native_tool_rejects: bool = False
    web_healthy_ok: bool = False
    web_lane_seconds_cold: float | None = None
    web_lane_seconds_warm: float | None = None
    coverage: dict[str, str] | None = None

    def failures(self) -> list[str]:
        issues: list[str] = []
        if not self.unit_tests_ok:
            issues.append("gate unit tests failed")
        if not self.missing_native_tool_rejects:
            issues.append("pre-commit did not reject missing native toolchain")
        for probe in self.probes:
            if probe.rejected != probe.expected_reject:
                issues.append(f"probe {probe.name}: expected reject={probe.expected_reject} got {probe.rejected}")
        if not self.web_healthy_ok:
            issues.append("healthy web-lane control failed")
        return issues


def run_cmd(args: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=cwd,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def git(args: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return run_cmd(["git", *args], cwd=cwd)


@contextmanager
def worktree_probe():
    with tempfile.TemporaryDirectory(prefix="lyre-l1-selftest-") as temporary:
        wt = Path(temporary) / "wt"
        sha = git(["rev-parse", "HEAD"], cwd=ROOT).stdout.strip()
        proc = run_cmd(["git", "worktree", "add", "--detach", str(wt), sha], cwd=ROOT)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or proc.stdout.strip())
        try:
            yield wt
        finally:
            run_cmd(["git", "worktree", "remove", "--force", str(wt)], cwd=ROOT)


def make_snapshot(wt: Path, temporary: Path) -> tuple[Path, Path]:
    snapshot = temporary / "source"
    snapshot.mkdir()
    gate.run(["git", "checkout-index", "--all", "--force", f"--prefix={snapshot}/"], wt)
    for relative in gate.DEPENDENCIES:
        source = ROOT / relative
        if not source.is_dir():
            raise RuntimeError(f"Missing installed dependency tree: {source}")
        gate.link_dependencies(source, snapshot / relative, wt, snapshot)
    return snapshot, temporary


def invoke_web_lane(wt: Path) -> tuple[bool, int, str, list[str]]:
    buffer = tempfile.TemporaryDirectory(prefix="lyre-l1-out-")
    commands: list[str] = []
    original = gate.run

    def tracking_run(args, cwd, capture=False):
        commands.append(str(args[0]))
        return original(args, cwd, capture=True)

    gate.run = tracking_run  # type: ignore[method-assign]
    prior_quiet = os.environ.get("LYRE_L1_QUIET")
    os.environ["LYRE_L1_QUIET"] = "1"
    with buffer as temporary:
        output = Path(temporary)
        snapshot, _ = make_snapshot(wt, output)
        try:
            gate.checks_web(wt, snapshot, output)
            return True, 0, "", commands
        except Exception as error:  # noqa: BLE001 — aggregate gate failures for reporting
            return False, 1, str(error), commands
        finally:
            gate.run = original
            if prior_quiet is None:
                os.environ.pop("LYRE_L1_QUIET", None)
            else:
                os.environ["LYRE_L1_QUIET"] = prior_quiet


def stage_file(wt: Path, relative: Path, content: str) -> None:
    path = wt / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    proc = git(["add", str(relative)], cwd=wt)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip())


def run_probe(wt: Path, name: str, expected_reject: bool, setup) -> ProbeResult:
    git(["reset", "--hard", "HEAD"], cwd=wt)
    git(["clean", "-fd"], cwd=wt)
    setup(wt)
    ok, code, detail, commands = invoke_web_lane(wt)
    rejected = not ok
    if name == "early-failure-blocks-later":
        rejected = not ok and "typecheck" not in commands
        if ok or "typecheck" in commands:
            detail = f"commands={commands} error={detail}"
    return ProbeResult(name, expected_reject, rejected, code, detail)


def read_coverage_summary() -> dict[str, str]:
    proc = run_cmd(
        [shutil.which("bun") or "bun", "run", "test:coverage"],
        cwd=ROOT,
        env={**os.environ, "CI": "1"},
    )
    if proc.returncode != 0:
        raise RuntimeError("test:coverage failed during measurement")
    metrics = {}
    for line in proc.stdout.splitlines():
        stripped = line.strip()
        if stripped.startswith("Statements") or stripped.startswith("Branches") or stripped.startswith(
            "Functions"
        ) or stripped.startswith("Lines"):
            key, _, rest = stripped.partition(":")
            metrics[key] = rest.strip()
    return metrics


def measure_web_lane(wt: Path) -> tuple[float, float]:
    start = time.monotonic()
    ok, _, detail, _ = invoke_web_lane(wt)
    cold = time.monotonic() - start
    if not ok:
        raise RuntimeError(f"cold web-lane control failed: {detail}")
    start = time.monotonic()
    ok, _, detail, _ = invoke_web_lane(wt)
    warm = time.monotonic() - start
    if not ok:
        raise RuntimeError(f"warm web-lane control failed: {detail}")
    return cold, warm


def run_unit_tests() -> bool:
    proc = run_cmd(
        [sys.executable, "-B", "-m", "unittest", "discover", "-s", "scripts", "-p", "test_*.py"],
        cwd=ROOT,
    )
    return proc.returncode == 0


@contextmanager
def controlled_tool_path(environment: dict[str, str]):
    with tempfile.TemporaryDirectory(prefix="lyre-l1-tools-") as temporary:
        directory = Path(temporary)
        for entry in environment.get("PATH", "").split(os.pathsep):
            source = Path(entry)
            if not source.is_dir():
                continue
            for tool in source.iterdir():
                target = directory / tool.name
                if tool.is_file() and os.access(tool, os.X_OK) and not target.exists():
                    target.symlink_to(tool.resolve())
        yield {**environment, "PATH": str(directory)}


def missing_tool_rejects() -> bool:
    required = [name for name in gate.TOOLS if name not in gate.WEB_TOOLS]
    environment = {**os.environ, **gate.ENV}
    command = [sys.executable, "-B", str(ROOT / "scripts/pre-commit.py")]
    for tool in required:
        if shutil.which(tool, path=environment.get("PATH", "")) is None:
            proc = run_cmd(command, cwd=ROOT, env=environment)
            return proc.returncode != 0 and f"Missing required tool: {tool}" in proc.stderr
    with controlled_tool_path(environment) as isolated:
        if any(shutil.which(tool, path=isolated["PATH"]) is None for tool in gate.TOOLS):
            return False
        healthy = run_cmd(command, cwd=ROOT, env=isolated)
        if healthy.returncode != 0:
            print(healthy.stdout + healthy.stderr, file=sys.stderr)
            return False
        for tool in required:
            link = Path(isolated["PATH"]) / tool
            original = link.readlink()
            link.unlink()
            try:
                if shutil.which(tool, path=isolated["PATH"]) is not None:
                    return False
                proc = run_cmd(command, cwd=ROOT, env=isolated)
                if proc.returncode == 0 or f"Missing required tool: {tool}" not in proc.stderr:
                    return False
            finally:
                link.symlink_to(original)
    return True


def build_probes() -> list[tuple[str, bool, callable]]:
    original_utils = UTILS_TS.read_text()
    original_vitest = VITEST_CONFIG.read_text()

    def setup_ut_fail(wt: Path) -> None:
        stage_file(
            wt,
            PROBE_TEST.relative_to(ROOT),
            (
                'import { describe, expect, it } from "vitest";\n\n'
                'describe("l1 gate probe", () => {\n'
                '\tit("fails", () => {\n'
                "\t\texpect(1).toBe(2);\n"
                "\t});\n"
                "});\n"
            ),
        )

    def setup_coverage_branches(wt: Path) -> None:
        text = original_vitest.replace("branches: 95", "branches: 100", 1)
        stage_file(wt, VITEST_CONFIG.relative_to(ROOT), text)

    def setup_lint_error(wt: Path) -> None:
        stage_file(wt, UTILS_TS.relative_to(ROOT), f"{original_utils}\ndebugger;\n")

    def setup_lint_warning(wt: Path) -> None:
        stage_file(
            wt,
            UTILS_TS.relative_to(ROOT),
            f"{original_utils}\nlet l1_probe = 1\n",
        )

    def setup_type_error(wt: Path) -> None:
        stage_file(wt, UTILS_TS.relative_to(ROOT), f"{original_utils}\nconst l1TypeProbe: number = 'bad';\n")

    def setup_test_only(wt: Path) -> None:
        stage_file(
            wt,
            PROBE_TEST.relative_to(ROOT),
            (
                'import { describe, expect, it } from "vitest";\n\n'
                'describe.only("l1 gate probe", () => {\n'
                '\tit("runs", () => {\n'
                "\t\texpect(true).toBe(true);\n"
                "\t});\n"
                "});\n"
            ),
        )

    def setup_test_skip(wt: Path) -> None:
        stage_file(
            wt,
            PROBE_TEST.relative_to(ROOT),
            (
                'import { describe, expect, it } from "vitest";\n\n'
                'describe("l1 gate probe", () => {\n'
                '\tit.skip("skipped", () => {\n'
                "\t\texpect(true).toBe(true);\n"
                "\t});\n"
                "});\n"
            ),
        )

    def setup_staged_bad_worktree_good(wt: Path) -> None:
        setup_lint_error(wt)
        UTILS_TS.write_text(original_utils)

    def setup_missing_report(wt: Path) -> None:
        stage_file(wt, UTILS_TS.relative_to(ROOT), original_utils)

    return [
        ("ut-failure", True, setup_ut_fail),
        ("coverage-branches-floor", True, setup_coverage_branches),
        ("lint-error", True, setup_lint_error),
        ("lint-warning", True, setup_lint_warning),
        ("type-error", True, setup_type_error),
        ("vitest-only", True, setup_test_only),
        ("vitest-skip", True, setup_test_skip),
        ("staged-bad-unstaged-good", True, setup_staged_bad_worktree_good),
        ("malformed-coverage-report", True, lambda wt: setup_missing_report(wt)),
        ("early-failure-blocks-later", True, setup_lint_error),
        ("healthy-web-control", False, lambda wt: None),
    ]


def main() -> int:
    for name in gate.WEB_TOOLS:
        if shutil.which(name, path=gate.ENV.get("PATH", "")) is None:
            print(f"gate-l1-selftest: missing web tool {name}", file=sys.stderr)
            return 1

    report = SelfTestReport(host=sys.platform)
    report.unit_tests_ok = run_unit_tests()
    report.missing_native_tool_rejects = missing_tool_rejects()

    with worktree_probe() as wt:
        for name, expected, setup in build_probes():
            if name == "malformed-coverage-report":
                git(["reset", "--hard", "HEAD"], cwd=wt)
                git(["clean", "-fd"], cwd=wt)
                with tempfile.TemporaryDirectory(prefix="lyre-l1-malformed-") as temporary:
                    output = Path(temporary)
                    snapshot, _ = make_snapshot(wt, output)
                    report_path = output / "tests.json"
                    report_path.write_text("not-json")
                    try:
                        gate.check_tests(report_path)
                        report.probes.append(ProbeResult(name, True, False, 0, "accepted malformed report"))
                    except Exception as error:  # noqa: BLE001
                        report.probes.append(ProbeResult(name, True, True, 1, str(error)))
                continue
            result = run_probe(wt, name, expected, setup)
            report.probes.append(result)
            if name == "healthy-web-control":
                report.web_healthy_ok = not result.rejected

        report.web_lane_seconds_cold, report.web_lane_seconds_warm = measure_web_lane(wt)

    try:
        report.coverage = read_coverage_summary()
    except Exception as error:  # noqa: BLE001
        print(f"gate-l1-selftest: coverage measurement failed: {error}", file=sys.stderr)
        return 1

    failures = report.failures()
    payload = {
        "host": report.host,
        "unit_tests_ok": report.unit_tests_ok,
        "missing_native_tool_rejects": report.missing_native_tool_rejects,
        "web_healthy_ok": report.web_healthy_ok,
        "web_lane_seconds": {"cold": report.web_lane_seconds_cold, "warm": report.web_lane_seconds_warm},
        "coverage": report.coverage,
        "probes": [
            {
                "name": p.name,
                "expected_reject": p.expected_reject,
                "rejected": p.rejected,
                "detail": p.detail,
            }
            for p in report.probes
        ],
        "failures": failures,
    }
    json.dump(payload, sys.stdout, indent=2)
    sys.stdout.write("\n")
    if failures:
        for item in failures:
            print(f"gate-l1-selftest: {item}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
