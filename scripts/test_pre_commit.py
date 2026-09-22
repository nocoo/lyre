import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location("gate", Path(__file__).with_name("pre-commit.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class GateTests(unittest.TestCase):
    def test_workspace_links_and_caches_stay_in_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            snapshot = Path(directory) / "snapshot"
            modules = root / "node_modules"
            modules.mkdir(parents=True)
            package = root / "packages/api"
            package.mkdir(parents=True)
            (modules / "workspace").symlink_to(package)
            ((modules / "library").resolve()).mkdir()
            (modules / ".cache").mkdir()
            (modules / ".vite-temp").mkdir()
            gate.link_dependencies(modules, snapshot / "node_modules", root, snapshot)
            self.assertEqual((snapshot / "node_modules/workspace").readlink(), (snapshot / "packages/api").resolve())
            self.assertEqual((snapshot / "node_modules/library").resolve(), (modules / "library").resolve())
            self.assertFalse((snapshot / "node_modules/.cache").exists())
            self.assertFalse((snapshot / "node_modules/.vite-temp").exists())

    def test_failed_command_and_timeout_reject(self):
        with self.assertRaises(subprocess.CalledProcessError):
            gate.run([sys.executable, "-c", "raise SystemExit(7)"], Path.cwd())
        old = gate.DEADLINE
        try:
            gate.DEADLINE = time.monotonic() + 0.05
            with self.assertRaises(subprocess.TimeoutExpired):
                gate.run([sys.executable, "-c", "import time; time.sleep(60)"], Path.cwd())
        finally:
            gate.DEADLINE = old

    def test_empty_skipped_and_malformed_reports_reject(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tests.json"
            for report in ({"success": True, "numTotalTests": 0},
                           {"success": True, "numTotalTests": 2, "numPendingTests": 1}):
                path.write_text(json.dumps(report))
                with self.assertRaises(RuntimeError):
                    gate.check_tests(path)
            path.write_text("invalid")
            with self.assertRaises(ValueError):
                gate.check_tests(path)
            path.write_text(json.dumps({"success": True, "numTotalTests": 2}))
            gate.check_tests(path)

    def test_native_metrics_block_independently(self):
        target = {"name": "App", "coveredLines": 96, "executableLines": 100,
                  "files": [{"functions": [{"executionCount": 1}]}]}
        def check():
            gate.check_native(json.dumps({"targets": [target]}), "App", 95, 95)
        check()
        target["coveredLines"] = 94
        with self.assertRaises(RuntimeError):
            check()
        target["coveredLines"] = 96
        target["files"][0]["functions"][0]["executionCount"] = 0
        with self.assertRaises(RuntimeError):
            check()


if __name__ == "__main__":
    unittest.main()
