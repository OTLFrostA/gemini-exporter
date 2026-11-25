#!/usr/bin/env python3
"""Unit tests for Tier 2 scenario pool management, custom dataset loader, and lifecycle tracker."""

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(BASE_DIR, "scripts")
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)


class ScenarioPoolAndDatasetTests(unittest.TestCase):
    def test_custom_dataset_loading(self):
        from test_live_chat_and_export import load_custom_dataset

        ok, res = load_custom_dataset(None)
        self.assertTrue(ok)
        self.assertIsNone(res)

        ok, res = load_custom_dataset("/path/to/non_existent_dataset.json")
        self.assertFalse(ok)
        self.assertIn("不存在", res)

        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".json", encoding="utf-8") as bad_file:
            bad_file.write("{invalid json content")
            bad_path = bad_file.name
        try:
            ok, res = load_custom_dataset(bad_path)
            self.assertFalse(ok)
            self.assertIn("失败", res)
        finally:
            if os.path.isfile(bad_path):
                os.remove(bad_path)

        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".json", encoding="utf-8") as ok_file:
            ok_file.write('[{"id":"test","title":"Test","turns":["Q1","A1"]}]')
            ok_path = ok_file.name
        try:
            ok, res = load_custom_dataset(ok_path)
            self.assertTrue(ok)
            self.assertIsInstance(res, list)
            self.assertEqual(len(res), 1)
        finally:
            if os.path.isfile(ok_path):
                os.remove(ok_path)

    def test_scenario_pool_pipeline(self):
        from manage_scenario_pool import validate_pool, consume_scenarios, topup_scenarios

        with tempfile.TemporaryDirectory() as tmp_dir:
            isolated_scripts = os.path.join(tmp_dir, "scripts")
            os.makedirs(isolated_scripts)
            for name in ["manage_scenario_pool.py", "test_scenario_pool.json"]:
                shutil.copy2(os.path.join(SCRIPTS_DIR, name), isolated_scripts)
            script = os.path.join(isolated_scripts, "manage_scenario_pool.py")
            corpus = os.path.join(isolated_scripts, "test_scenario_pool.json")
            with open(corpus, "rb") as f:
                original_corpus = f.read()
            for count in [0, -1]:
                for flags in [[], ["--dry-run"]]:
                    result = subprocess.run(
                        [sys.executable, script, "consume", "--count", str(count), *flags],
                        capture_output=True, text=True,
                    )
                    self.assertNotEqual(result.returncode, 0, result.stdout)
                    self.assertIn("--count", result.stderr)
                    self.assertIn("positive integer", result.stderr)
                    self.assertFalse(os.path.exists(os.path.join(tmp_dir, "temp")))
                    with open(corpus, "rb") as f:
                        self.assertEqual(f.read(), original_corpus)

        scenarios = [
            {
                "id": f"unit_scenario_{i:02d}",
                "title": f"Unit Scenario {i}",
                "domain": f"unit_domain_{i % 10}",
                "features": ["imagen", "creative"] if i < 2 else ["code"],
                "turns": [f"prompt {i} turn 1", f"prompt {i} turn 2"],
            }
            for i in range(20)
        ]

        with tempfile.TemporaryDirectory() as tmp_dir:
            pool_path = os.path.join(tmp_dir, "pool.json")
            archive_path = os.path.join(tmp_dir, "archive.json")
            with open(pool_path, "w", encoding="utf-8") as f:
                json.dump(scenarios, f, ensure_ascii=False)

            for count in [0, -1]:
                for dry_run in [False, True]:
                    with self.assertRaisesRegex(ValueError, "positive integer"):
                        consume_scenarios(pool_path, count=count, archive_path=archive_path, dry_run=dry_run)

            ok, errs, status = validate_pool(pool_path, strict_count=True)
            self.assertTrue(ok, f"Scenario pool validation failed: {errs}")
            self.assertEqual(status["count"], 20)
            self.assertGreaterEqual(status["has_imagen"], 2)
            self.assertGreaterEqual(len(status["domains"]), 10)

            selected, pool_after = consume_scenarios(pool_path, count=2, dry_run=True, require_imagen=True)
            self.assertEqual(len(selected), 2)
            self.assertEqual(len(pool_after), 18)
            self.assertTrue(any("imagen" in s.get("features", []) for s in selected))
            self.assertFalse(os.path.exists(archive_path))

            consumed, remaining = consume_scenarios(
                pool_path, count=2, archive_path=archive_path, dry_run=False, require_imagen=True
            )
            self.assertEqual([s["id"] for s in consumed], [s["id"] for s in selected])
            self.assertEqual(len(remaining), 18)
            with open(archive_path, "r", encoding="utf-8") as f:
                archived = json.load(f)
            self.assertEqual(len(archived), 2)
            self.assertTrue(all("consumed_at" in item for item in archived))

            ok, errs, _ = validate_pool(pool_path, strict_count=True)
            self.assertFalse(ok)
            self.assertTrue(any("水位不足" in err for err in errs))

            added, restored_pool = topup_scenarios(consumed, pool_path=pool_path)
            self.assertEqual(len(added), 2)
            self.assertEqual(len(restored_pool), 20)
            ok, errs, restored_status = validate_pool(pool_path, strict_count=True)
            self.assertTrue(ok, f"Restored scenario pool validation failed: {errs}")
            self.assertEqual(restored_status["count"], 20)

            with open(pool_path, "w", encoding="utf-8") as f:
                json.dump([], f)
            with self.assertRaisesRegex(ValueError, "数量不足"):
                consume_scenarios(pool_path, count=2, archive_path=archive_path)

    def test_online_scenario_provider_and_lifecycle_tracker(self):
        from framework.scenario_provider import OnlineScenarioProvider
        from framework.lifecycle_tracker import SessionLifecycleTracker

        mock_pool = [
            {"id": "sc_img", "title": "Imagen Test", "features": ["imagen", "creative"], "turns": ["draw a cat", "draw a dog"]},
            {"id": "sc_code", "title": "Code Test", "features": ["code", "python"], "turns": ["write fibonacci", "optimize it"]},
        ]
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".json", encoding="utf-8") as f_p:
            json.dump(mock_pool, f_p, ensure_ascii=False)
            p_path = f_p.name
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".json", encoding="utf-8") as f_a:
            json.dump([], f_a)
            a_path = f_a.name

        try:
            prov = OnlineScenarioProvider(pool_path=p_path, archive_path=a_path)
            status = prov.get_status()
            self.assertEqual(status["count"], 2)
            self.assertEqual(status["has_imagen"], 1)

            with contextlib.redirect_stdout(io.StringIO()):
                sc1 = prov.pop_scenario(required_features=["imagen"])
                self.assertEqual(sc1["id"], "sc_img")
                self.assertEqual(prov.get_status()["count"], 1)

                sc2 = prov.pop_scenario()
                self.assertEqual(sc2["id"], "sc_code")
                self.assertEqual(prov.get_status()["count"], 0)

            with open(a_path, "r", encoding="utf-8") as af:
                archived = json.load(af)
            self.assertEqual(len(archived), 2)
            self.assertIn("consumed_at", archived[0])

            eq = prov.pop_ephemeral_query()
            self.assertTrue("瞬态一致性" in eq or len(eq) > 10)

            with self.assertRaisesRegex(RuntimeError, "场景池已枯竭"):
                prov.pop_scenario()
        finally:
            for p in [p_path, a_path]:
                if os.path.isfile(p):
                    os.remove(p)

        tracker = SessionLifecycleTracker()
        with contextlib.redirect_stdout(io.StringIO()):
            tracker.track("chat_abc_1")
            tracker.track("chat_abc_2")
            tracker.track("chat_abc_1")
        self.assertEqual(len(tracker._tracked_chat_ids), 2)

        tracker.mark_deleted("chat_abc_1")
        self.assertIn("chat_abc_1", tracker._deleted_chat_ids)
        self.assertEqual(tracker.get_active_chats(), ["chat_abc_2"])

        with contextlib.redirect_stdout(io.StringIO()):
            retained = tracker.teardown()
        self.assertEqual(retained, 1)


if __name__ == "__main__":
    unittest.main()
