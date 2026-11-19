"""Exercise the documented unit-test filter through its CLI."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class RunTestsFilterTests(unittest.TestCase):
    def run_filter(self, keyword, root=ROOT, env=None):
        return subprocess.run(
            [sys.executable, "tests/run_tests.py", "--filter", keyword],
            cwd=root,
            env=env,
            capture_output=True,
            encoding="utf-8",
            timeout=60,
        )

    def assert_passed(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_runs_a_python_suite_by_case_insensitive_filename(self):
        result = self.run_filter("TEST_INTEGRITY_MODEL")
        self.assert_passed(result)
        self.assertIn("tests/test_integrity_model.py", result.stdout.replace("\\", "/"))
        self.assertRegex(result.stderr, r"Ran [1-9]\d* tests?")

    def test_runs_the_commonjs_migration_suite_by_filename(self):
        result = self.run_filter("upgrade_v1")
        self.assert_passed(result)
        self.assertIn("Unit test suite passed: tests/upgrade_v1.test.cjs",
                      result.stdout.replace("\\", "/"))

    def test_keeps_sibling_python_imports_available_in_a_mixed_filter(self):
        result = self.run_filter("platform")
        self.assert_passed(result)
        output = result.stdout.replace("\\", "/")
        self.assertIn("Unit test suite passed: tests/test_tier2_platforms.py", output)
        self.assertIn("Unit test suite passed: tests/platform_permissions.test.ts", output)

    def test_runs_a_python_suite_named_like_the_module_it_tests(self):
        result = self.run_filter("impact_analyzer")
        self.assert_passed(result)
        self.assertIn("Unit test suite passed: tests/test_impact_analyzer.py",
                      result.stdout.replace("\\", "/"))
        self.assertRegex(result.stderr, r"Ran [1-9]\d* tests?")

    def test_prefers_the_checkout_over_another_tests_package(self):
        with tempfile.TemporaryDirectory() as directory:
            foreign_tests = Path(directory, "tests")
            foreign_tests.mkdir()
            (foreign_tests / "__init__.py").touch()
            env = {**os.environ, "PYTHONPATH": directory}
            result = self.run_filter("test_integrity_model", env=env)

        self.assert_passed(result)
        self.assertRegex(result.stderr, r"Ran [1-9]\d* tests?")

    def test_runs_matching_languages_without_running_the_migration_twice(self):
        result = self.run_filter("upgrade")
        self.assert_passed(result)
        output = result.stdout.replace("\\", "/")
        self.assertIn("Unit test suite passed: tests/gemini_integrity_upgrade.test.ts", output)
        self.assertIn("Unit test suite passed: tests/upgrade_v1.test.cjs", output)
        self.assertIn("tests/test_upgrade_profile.py", output)
        self.assertNotIn("tests/upgrade_released_v17.test.ts", output)

    def test_no_match_is_an_error(self):
        result = self.run_filter("not-a-real-gemini-exporter-suite")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("未找到", result.stdout)

    def test_a_failing_python_suite_fails_the_filter(self):
        with tempfile.TemporaryDirectory() as directory:
            tests_dir = Path(directory, "tests")
            tests_dir.mkdir()
            (tests_dir / "__init__.py").touch()
            shutil.copyfile(ROOT / "tests/run_tests.py", tests_dir / "run_tests.py")
            (tests_dir / "test_deliberate_failure.py").write_text(
                "import unittest\n"
                "class Failure(unittest.TestCase):\n"
                "    def test_failure(self):\n"
                "        self.fail('deliberate Python failure')\n",
                encoding="utf-8",
            )
            result = self.run_filter("deliberate_failure", root=directory)

        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("AssertionError: deliberate Python failure", result.stderr)
        self.assertNotIn("均顺利通过", result.stdout)


if __name__ == "__main__":
    unittest.main()
