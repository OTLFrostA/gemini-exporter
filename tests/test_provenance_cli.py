"""Subprocess regression checks for the provenance inspector CLI."""
import json
from pathlib import Path
import subprocess
import sys
import unittest


BASE_DIR = Path(__file__).resolve().parents[1]
CLI = BASE_DIR / "scripts/parser_migration/test_provenance.py"
MANIFEST = CLI.with_name("test_provenance_manifest.json")


class TestProvenanceCLI(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run(
            [sys.executable, str(CLI), *args], cwd=BASE_DIR,
            capture_output=True, text=True, encoding="utf-8", timeout=30,
        )

    def test_chatgpt_suites_are_listed(self):
        result = self.run_cli("--domain", "chatgpt")
        self.assertEqual(result.returncode, 0, result.stderr)
        suites = json.loads(MANIFEST.read_text(encoding="utf-8"))["suites"]
        expected = [suite for suite in suites if suite["domain"] == "chatgpt"]
        self.assertTrue(expected)
        self.assertIn(f"domain=chatgpt): {len(expected)} suites", result.stdout)
        for suite in expected:
            self.assertIn(suite["file"], result.stdout)

    def test_unknown_domain_is_rejected(self):
        result = self.run_cli("--domain", "bogus")
        self.assertEqual(result.returncode, 2)
        self.assertIn("argument --domain: invalid choice: 'bogus'", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_help_lists_manifest_domains(self):
        result = self.run_cli("--help")
        self.assertEqual(result.returncode, 0, result.stderr)
        suites = json.loads(MANIFEST.read_text(encoding="utf-8"))["suites"]
        for domain in {suite["domain"] for suite in suites}:
            self.assertIn(domain, result.stdout)


if __name__ == "__main__":
    unittest.main()
