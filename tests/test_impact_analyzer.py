#!/usr/bin/env python3
"""
tests/test_impact_analyzer.py
-----------------------------
Unit tests for scripts/test_impact_analyzer.py (Test Impact Analysis & Dependency Graph).
"""

import os
import sys
import unittest
import shutil
import subprocess
import tempfile
from pathlib import Path

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
scripts_dir = os.path.join(BASE_DIR, "scripts")
if scripts_dir not in sys.path:
    sys.path.insert(0, scripts_dir)

from test_impact_analyzer import (
    DependencyGraph,
    analyze_impact,
    normalize_repo_path,
    resolve_import_path,
    GLOBAL_FILES
)


class TestImpactAnalyzer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.graph = DependencyGraph(base_dir=BASE_DIR)

    def test_storage_service_transitive_dependencies(self):
        """核心断言：修改底层 storageService.ts 必须传递影响所有依赖它的模块与测试"""
        target = "src/l3a/storageService.ts"
        affected = self.graph.get_transitive_dependents({target})

        # 直接与传递引用 (extension-origin 持久化链路，且不应泄漏到 Content 嗅探桥接层)
        self.assertIn("src/runtime/background/domainStorageHandler.ts", affected)
        self.assertIn("src/ui/options/options.ts", affected)
        self.assertNotIn("src/l1/sniffer/gemini/messageBridge.ts", affected)
        self.assertIn("tests/application_export.test.ts", affected)

        # 传递间接引用 (via syncEngine or options)
        self.assertIn("tests/six-module-integration.test.ts", affected)
        self.assertIn("tests/ui_v2.test.ts", affected)

        # 影响分析结果断言
        res = analyze_impact({target}, graph=self.graph, base_dir=BASE_DIR)
        self.assertFalse(res.is_all_affected)
        self.assertFalse(res.is_docs_only)
        self.assertGreaterEqual(len(res.target_unit_tests), 15)
        self.assertIn("tests/application_export.test.ts", res.target_unit_tests)
        self.assertIn("tests/ui_v2.test.ts", res.target_unit_tests)
        # core 变动应触发所有 E2E
        self.assertEqual(len(res.target_e2e_specs), len(res.all_e2e_specs))

    def test_localized_badge_view_impact(self):
        """修改局部的 badgeView.ts 只应该影响 content 相关的少数测试，不应全量执行"""
        target = "src/ui/badge/badgeView.ts"
        res = analyze_impact({target}, graph=self.graph, base_dir=BASE_DIR)
        self.assertFalse(res.is_all_affected)
        self.assertFalse(res.is_docs_only)

        # 仅影响少数几个单元测试
        self.assertLess(len(res.target_unit_tests), len(res.all_unit_tests) // 3)
        self.assertIn("tests/ui_v2.test.ts", res.target_unit_tests)
        self.assertNotIn("tests/takeout_engine.test.ts", res.target_unit_tests)

        # 仅影响 content 相关的 E2E
        self.assertIn("tests/e2e/production_v2.spec.ts", res.target_e2e_specs)
        self.assertIn("tests/e2e/account_registry.spec.ts", res.target_e2e_specs)
        self.assertNotIn("tests/e2e/native_parser.spec.ts", res.target_e2e_specs)

    def test_tsx_component_dependencies_reach_the_workbench(self):
        target = "src/ui/options/views/conversationList.tsx"
        self.assertEqual(resolve_import_path("src/ui/options/views/listView.ts", "./conversationList.js", BASE_DIR), target)
        self.assertIn("src/ui/options/views/listView.ts", self.graph.get_transitive_dependents({target}))
        self.assertIn("src/ui/options/options.ts", self.graph.get_transitive_dependents({target}))
        # Scanning TSX's own imports matters when a lower-level dependency changes.
        self.assertIn(target, self.graph.get_transitive_dependents({"src/ui/shared/exportSummary.ts"}))

    def test_global_config_fallback_triggers_all(self):
        """修改 package.json 或 tsconfig.json 等核心配置必须兜底触发全量测试"""
        for gf in ["package.json", "tsconfig.json", "build.js"]:
            res = analyze_impact({gf}, graph=self.graph, base_dir=BASE_DIR)
            self.assertTrue(res.is_all_affected)
            self.assertEqual(len(res.target_unit_tests), len(res.all_unit_tests))
            self.assertEqual(len(res.target_e2e_specs), len(res.all_e2e_specs))

    def test_docs_only_bypass(self):
        """纯文档或测试场景池变更必须秒级旁路通过"""
        res = analyze_impact({"README.md", "docs/architecture.md", "scripts/test_scenario_pool.json"}, graph=self.graph, base_dir=BASE_DIR)
        self.assertFalse(res.is_all_affected)
        self.assertTrue(res.is_docs_only)
        self.assertEqual(len(res.target_unit_tests), 0)
        self.assertEqual(len(res.target_e2e_specs), 0)

    def test_import_pattern_filtering_and_dynamic_imports(self):
        """验证 IMPORT_PATTERN 正确跳过 import type / export type，并正确解析动态 import()"""
        from test_impact_analyzer import IMPORT_PATTERN
        sample = """
        import { foo } from "./runtime_foo";
        import type { BarType } from "./type_bar";
        export { baz } from "./runtime_baz";
        export type { QuuxType } from "./type_quux";
        const lazyMod = import("./dynamic_lazy");
        const reqMod = require("./cjs_req");
        """
        matches = [m.group(1) or m.group(2) for m in IMPORT_PATTERN.finditer(sample)]
        self.assertIn("./runtime_foo", matches)
        self.assertIn("./runtime_baz", matches)
        self.assertIn("./dynamic_lazy", matches)
        self.assertIn("./cjs_req", matches)
        self.assertNotIn("./type_bar", matches)
        self.assertNotIn("./type_quux", matches)


class TestChangedPythonRunner(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        for name in ("tests/run_tests.py", "scripts/test_impact_analyzer.py", "scripts/run_changed_tests.py"):
            destination = self.repo / name
            destination.parent.mkdir(exist_ok=True)
            shutil.copyfile(Path(BASE_DIR) / name, destination)
        (self.repo / "build.js").write_text("console.log('fixture build');\n")
        (self.repo / "tests/__init__.py").touch()
        (self.repo / "tests/sibling_helper.py").write_text("MESSAGE = 'PYTHON_SUITE_EXECUTED'\n")
        (self.repo / "tests/test_example.py").write_text(
            "import unittest\n"
            "from sibling_helper import MESSAGE\n"
            "class ExampleTest(unittest.TestCase):\n"
            "    def test_example(self):\n"
            "        print(MESSAGE)\n"
        )

    def run_changed(self, orchestrator=False, files=None):
        entry = "scripts/run_changed_tests.py" if orchestrator else "tests/run_tests.py"
        args = ["--skip-typecheck", "--skip-e2e"] if orchestrator else ["--changed"]
        env = dict(os.environ, GEMINI_SKIP_REDUNDANT_TSC="1")
        return subprocess.run(
            [sys.executable, str(self.repo / entry), *args, "--files",
             *(files if files is not None else ["tests/test_example.py"])],
            cwd=self.repo, env=env, capture_output=True, text=True, timeout=30,
        )

    def test_changed_python_suite_runs_through_both_entries(self):
        for orchestrator in (False, True):
            with self.subTest(orchestrator=orchestrator):
                result = self.run_changed(orchestrator)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("PYTHON_SUITE_EXECUTED", result.stdout)
                self.assertIn("Ran 1 test", result.stderr)

    def test_changed_python_failure_propagates_through_both_entries(self):
        (self.repo / "tests/test_example.py").write_text(
            "import unittest\n"
            "class ExampleTest(unittest.TestCase):\n"
            "    def test_example(self):\n"
            "        self.fail('FORCED_PYTHON_FAILURE')\n"
        )
        for orchestrator in (False, True):
            with self.subTest(orchestrator=orchestrator):
                result = self.run_changed(orchestrator)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("FORCED_PYTHON_FAILURE", result.stdout + result.stderr)

    def test_nested_python_suite_can_import_siblings(self):
        nested = self.repo / "tests/nested"
        nested.mkdir()
        (nested / "__init__.py").touch()
        for filename in ("test_example.py", "sibling_helper.py"):
            shutil.copyfile(self.repo / "tests" / filename, nested / filename)
        for orchestrator in (False, True):
            with self.subTest(orchestrator=orchestrator):
                result = self.run_changed(orchestrator, files=["tests/nested/test_example.py"])
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("PYTHON_SUITE_EXECUTED", result.stdout)
                self.assertIn("Ran 1 test", result.stderr)

    def test_docs_and_deleted_python_tests_do_not_run(self):
        for files in (["README.md"], ["tests/test_deleted.py"]):
            with self.subTest(files=files):
                result = self.run_changed(files=files)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertNotIn("PYTHON_SUITE_EXECUTED", result.stdout)


if __name__ == "__main__":
    unittest.main()
