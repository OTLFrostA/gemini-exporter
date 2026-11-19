#!/usr/bin/env python3
"""
tests/test_impact_analyzer.py
-----------------------------
Unit tests for scripts/test_impact_analyzer.py (Test Impact Analysis & Dependency Graph).
"""

import os
import subprocess
import sys
import json
import tempfile
import unittest
from contextlib import contextmanager
from unittest.mock import patch

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
scripts_dir = os.path.join(BASE_DIR, "scripts")
if scripts_dir not in sys.path:
    sys.path.insert(0, scripts_dir)

from test_impact_analyzer import (
    DependencyGraph,
    get_git_changed_files,
    analyze_impact,
    normalize_repo_path,
    resolve_import_path,
    GLOBAL_FILES
)


class TestImpactAnalyzer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.graph = DependencyGraph(base_dir=BASE_DIR)

    @contextmanager
    def git_repo(self):
        with tempfile.TemporaryDirectory() as repo:
            subprocess.run(["git", "init", "-b", "main", repo], check=True, capture_output=True)
            subprocess.run(
                ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com",
                 "commit", "--allow-empty", "-m", "Initial commit"],
                cwd=repo, check=True, capture_output=True,
            )
            yield repo

    def test_invalid_base_fails_incremental_runner(self):
        with self.git_repo() as repo:
            env = dict(os.environ, GIT_DIR=os.path.join(repo, ".git"), GIT_WORK_TREE=repo)
            result = subprocess.run(
                [sys.executable, os.path.join(BASE_DIR, "scripts", "run_changed_tests.py"),
                 "--base", "review/nonexistent-base"],
                cwd=BASE_DIR, env=env, capture_output=True, text=True,
            )
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Invalid Git base ref", result.stderr)
        self.assertIn("review/nonexistent-base", result.stderr)
        self.assertNotIn("INCREMENTAL TESTS PASSED", result.stdout)

    def test_valid_base_and_default_detect_same_changes(self):
        with self.git_repo() as repo:
            self.assertEqual(get_git_changed_files("HEAD", repo), set())
            self.assertEqual(get_git_changed_files(base_dir=repo), set())
            with open(os.path.join(repo, "README.md"), "w", encoding="utf-8") as file:
                file.write("Documentation\n")
            self.assertEqual(get_git_changed_files("HEAD", repo), {"README.md"})
            self.assertEqual(get_git_changed_files(base_dir=repo), {"README.md"})

    def test_git_diff_failure_is_not_an_empty_change_set(self):
        run = subprocess.run

        def fail_diff(command, **kwargs):
            if command[:2] == ["git", "diff"]:
                return subprocess.CompletedProcess(command, 128, "", "diff failed")
            return run(command, **kwargs)

        with patch("test_impact_analyzer.subprocess.run", side_effect=fail_diff):
            with self.assertRaisesRegex(RuntimeError, "diff failed"):
                get_git_changed_files("HEAD")

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

    def test_playwright_config_cli_triggers_all(self):
        result = subprocess.run(
            [sys.executable, os.path.join(scripts_dir, "test_impact_analyzer.py"),
             "--files", "playwright.config.ts", "--json"],
            cwd=BASE_DIR, capture_output=True, text=True, check=True,
        )
        impact = json.loads(result.stdout)
        self.assertTrue(impact["is_all_affected"])
        self.assertFalse(impact["is_docs_only"])
        self.assertEqual(impact["changed_files"], ["playwright.config.ts"])
        all_tests = analyze_impact({"package.json"}, graph=self.graph, base_dir=BASE_DIR)
        self.assertTrue(impact["target_unit_tests"])
        self.assertTrue(impact["target_e2e_specs"])
        self.assertEqual(impact["target_unit_tests"], all_tests.target_unit_tests)
        self.assertEqual(impact["target_e2e_specs"], all_tests.target_e2e_specs)

    def test_fixture_changes_fall_back_to_all_tests(self):
        for target in (
            "tests/fixtures/provider/math/gm_md_004_evidence.md",
            "tests/fixtures/deleted.md",
            "tests/fixtures/image.png",
            "tests/fixtures/data.json",
        ):
            with self.subTest(target=target):
                res = analyze_impact({target}, graph=self.graph, base_dir=BASE_DIR)
                self.assertFalse(res.is_docs_only)
                self.assertTrue(res.is_all_affected)
                self.assertIn("tests/gemini_live_parser_regressions.test.ts", res.target_unit_tests)
                self.assertEqual(res.target_unit_tests, res.all_unit_tests)
                self.assertEqual(res.target_e2e_specs, res.all_e2e_specs)

    def test_fixture_mixed_with_docs_is_not_docs_only(self):
        res = analyze_impact(
            {"README.md", "tests/fixtures/provider/math/gm_md_004_evidence.md"},
            graph=self.graph, base_dir=BASE_DIR,
        )
        self.assertFalse(res.is_docs_only)
        self.assertIn("tests/gemini_live_parser_regressions.test.ts", res.target_unit_tests)

    def test_no_changes_bypass(self):
        res = analyze_impact(set(), graph=self.graph, base_dir=BASE_DIR)
        self.assertTrue(res.is_docs_only)
        self.assertEqual(res.target_unit_tests, [])
        self.assertEqual(res.target_e2e_specs, [])

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


if __name__ == "__main__":
    unittest.main()
