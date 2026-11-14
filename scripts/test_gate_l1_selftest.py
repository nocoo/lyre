import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("selftest", Path(__file__).with_name("gate_l1_selftest.py"))
selftest = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = selftest
spec.loader.exec_module(selftest)


class ToolPathTests(unittest.TestCase):
    def test_controlled_path_preserves_precedence_and_only_changes_owned_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            first = Path(temporary) / "bin"
            second = Path(temporary) / "other-bin"
            first.mkdir()
            second.mkdir()
            (first / "swiftlint").symlink_to(sys.executable)
            (second / "swiftlint").symlink_to("/bin/sh")
            (first / "not-executable").write_text("data")
            (first / "directory").mkdir()
            environment = {"PATH": os.pathsep.join(map(str, (first, second))), "HOME": temporary}
            with selftest.controlled_tool_path(environment) as isolated:
                controlled = Path(isolated["PATH"])
                self.assertEqual(isolated["HOME"], temporary)
                self.assertEqual((controlled / "swiftlint").resolve(), Path(sys.executable).resolve())
                self.assertFalse((controlled / "not-executable").exists())
                self.assertFalse((controlled / "directory").exists())
                self.assertIsNotNone(shutil.which("swiftlint", path=isolated["PATH"]))
                (controlled / "swiftlint").unlink()
                self.assertIsNone(shutil.which("swiftlint", path=isolated["PATH"]))
                self.assertTrue((first / "swiftlint").exists())
                self.assertTrue((second / "swiftlint").exists())
            self.assertFalse(controlled.exists())
            self.assertEqual(environment["PATH"], os.pathsep.join(map(str, (first, second))))

    def test_production_gate_rejects_actually_absent_native_tool(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for tool in selftest.gate.WEB_TOOLS:
                executable = shutil.which(tool)
                self.assertIsNotNone(executable)
                (directory / tool).symlink_to(executable)
            self.assertIsNone(shutil.which("swiftlint", path=temporary))
            result = subprocess.run(
                [sys.executable, "-B", str(Path(__file__).with_name("pre-commit.py"))],
                env={**os.environ, "PATH": temporary}, capture_output=True, text=True, check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Missing required tool: swiftlint", result.stderr)

    def test_probe_rejects_unrelated_failure_and_unexpected_acceptance(self):
        with patch.object(selftest.shutil, "which", return_value=None):
            for code, error, expected in (
                (0, "", False),
                (1, "unrelated failure", False),
                (1, "pre-commit failed: Missing required tool: swiftlint", True),
            ):
                with self.subTest(code=code, error=error):
                    result = subprocess.CompletedProcess([], code, "", error)
                    with patch.object(selftest, "run_cmd", return_value=result):
                        self.assertEqual(selftest.missing_tool_rejects(), expected)


if __name__ == "__main__":
    unittest.main()
