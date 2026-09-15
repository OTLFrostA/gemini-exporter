# tests/test_visual_sandbox.py
"""
Unit tests for Tier 3 Visual Sandbox and Autonomous QA Agent:
- VisualSandbox physical mouse/keyboard actuation, pure screenshot observation, and wait_on primitives
- VisualQAAgent perception-action closed loop, self-healing retries, and scorecard recording
"""

import os
import sys
import time
import base64
import tempfile
import unittest
from typing import Dict, Any, List, Optional

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from scripts.visual_agent.sandbox import VisualSandbox, ScreenObservation, WaitResult
from scripts.visual_agent.providers.base import VisionProvider, VisualAction, VisualActionType
from scripts.visual_agent.agent import VisualQAAgent, TestMission
from scripts.visual_agent.scorecard import VisualUXScorecard, SelfHealingEvent, VisualRisk


class MockCDP:
    """Mock CDP connection for isolated unit testing of VisualSandbox."""
    def __init__(self, eval_return=None):
        self.eval_return = eval_return
        self.eval_history: List[str] = []
        self.call_history: List[Dict[str, Any]] = []

    def eval(self, expr: str, await_promise: bool = False) -> Any:
        self.eval_history.append(expr)
        if callable(self.eval_return):
            return self.eval_return(expr)
        return self.eval_return

    def call(self, method: str, params: Optional[Dict[str, Any]] = None) -> Any:
        self.call_history.append({"method": method, "params": params or {}})
        if method == "Page.captureScreenshot":
            # 1x1 最小合法透明 PNG Base64
            tiny_png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
            return {"result": {"data": tiny_png_b64}}
        return {}


class MockCustomVisionProvider(VisionProvider):
    """Deterministic mock vision provider for agent testing."""
    def __init__(self, action_sequence: List[VisualAction]):
        self.action_sequence = list(action_sequence)
        self.call_count = 0

    def decide_action(
        self,
        screenshot_bytes: bytes,
        instruction: str,
        history: List[Dict[str, Any]],
        context: Optional[Dict[str, Any]] = None
    ) -> VisualAction:
        if self.call_count < len(self.action_sequence):
            action = self.action_sequence[self.call_count]
        else:
            action = VisualAction(action_type=VisualActionType.DONE, thought="Fallback DONE")
        self.call_count += 1
        return action


class TestVisualSandbox(unittest.TestCase):
    def setUp(self):
        self.mock_cdp = MockCDP()
        self.temp_dir = tempfile.mkdtemp()
        self.sandbox = VisualSandbox(
            cdp=self.mock_cdp,
            viewport_size=(1280, 800),
            output_dir=self.temp_dir
        )

    def tearDown(self):
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_viewport_normalization(self):
        # 1. 归一化坐标转换 (0.5, 0.5) -> (640, 400)
        px_x, px_y = self.sandbox._to_pixel(0.5, 0.5)
        self.assertEqual(px_x, 640)
        self.assertEqual(px_y, 400)

        # 2. 边界约束测试
        px_x, px_y = self.sandbox._to_pixel(1.5, -0.2)
        self.assertEqual(px_x, 1)  # 1.5 > 1.0 -> absolute 1
        self.assertEqual(px_y, 0)  # clamped to 0

        # 3. 绝对像素坐标
        px_x, px_y = self.sandbox._to_pixel(100.0, 200.0)
        self.assertEqual(px_x, 100)
        self.assertEqual(px_y, 200)

    def test_capture_screen_pure_perception(self):
        obs = self.sandbox.capture_screen("test_shot")
        self.assertIsInstance(obs, ScreenObservation)
        self.assertTrue(len(obs.image_bytes) > 0)
        self.assertTrue(os.path.isfile(obs.file_path))
        self.assertEqual(obs.viewport, (1280, 800))

        # 验证历史记录中不包含 DOM 树信息
        self.assertEqual(len(self.sandbox.history), 1)
        self.assertEqual(self.sandbox.history[0]["action"], "capture_screen")
        self.assertNotIn("dom", self.sandbox.history[0])

    def test_mouse_click_hardware_sequence(self):
        self.sandbox.mouse_click(0.25, 0.75, label="unit_click")
        calls = [c for c in self.mock_cdp.call_history if c["method"] == "Input.dispatchMouseEvent"]

        # 必须按照 mouseMoved -> mousePressed -> mouseReleased 三部曲派发
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[0]["params"]["type"], "mouseMoved")
        self.assertEqual(calls[0]["params"]["x"], 320)
        self.assertEqual(calls[0]["params"]["y"], 600)

        self.assertEqual(calls[1]["params"]["type"], "mousePressed")
        self.assertEqual(calls[1]["params"]["button"], "left")

        self.assertEqual(calls[2]["params"]["type"], "mouseReleased")
        self.assertEqual(calls[2]["params"]["button"], "left")

    def test_mouse_scroll(self):
        self.sandbox.mouse_scroll(delta_y=250)
        calls = [c for c in self.mock_cdp.call_history if c["method"] == "Input.dispatchMouseEvent" and c["params"]["type"] == "mouseWheel"]
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["params"]["deltaY"], 250)

    def test_input_text_hardware_typing(self):
        # 带有清空原内容与硬件剪贴板粘贴
        self.sandbox.input_text(x=0.5, y=0.5, text="Hello AI", clear_first=True, use_insert=True)

        insert_calls = [c for c in self.mock_cdp.call_history if c["method"] == "Input.insertText"]
        self.assertEqual(len(insert_calls), 1)
        self.assertEqual(insert_calls[0]["params"]["text"], "Hello AI")

        # 验证派发了清空快捷键事件 (rawKeyDown KeyA / Backspace)
        key_calls = [c for c in self.mock_cdp.call_history if c["method"] == "Input.dispatchKeyEvent"]
        self.assertTrue(len(key_calls) >= 4)

    def test_wait_on_zip_downloaded(self):
        # 预先在输出目录创建一个合格的 ZIP 文件
        fake_zip = os.path.join(self.temp_dir, "gemini_export_2026.zip")
        with open(fake_zip, "wb") as f:
            f.write(b"PK\x05\x06" + b"\x00" * 18)  # 最小空 zip 标头

        res = self.sandbox.wait_on("zip_downloaded", timeout=2, download_dir=self.temp_dir)
        self.assertTrue(res.success)
        self.assertIn("gemini_export_2026.zip", res.message)
        self.assertEqual(res.data["file_path"], fake_zip)


class TestVisualQAAgent(unittest.TestCase):
    def setUp(self):
        self.mock_cdp = MockCDP()
        self.temp_dir = tempfile.mkdtemp()
        self.sandbox = VisualSandbox(
            cdp=self.mock_cdp,
            viewport_size=(1280, 800),
            output_dir=self.temp_dir
        )
        self.scorecard = VisualUXScorecard(output_dir=self.temp_dir)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_execute_visual_step_click_success(self):
        provider = MockCustomVisionProvider([
            VisualAction(action_type=VisualActionType.CLICK, x=0.5, y=0.5, thought="Click center")
        ])
        agent = VisualQAAgent(sandbox=self.sandbox, provider=provider, scorecard=self.scorecard)

        verified = [False]
        def verify():
            verified[0] = True
            return True

        res = agent.execute_visual_step("step_click", "点击中心按钮", verify_fn=verify)
        self.assertTrue(res)
        self.assertTrue(verified[0])

        # 校验物理鼠标事件已被派遣
        mouse_calls = [c for c in self.mock_cdp.call_history if c["method"] == "Input.dispatchMouseEvent"]
        self.assertEqual(len(mouse_calls), 3)

    def test_execute_visual_step_self_healing(self):
        # 第一次点击未满足 verify_fn，第二次重试满足
        provider = MockCustomVisionProvider([
            VisualAction(action_type=VisualActionType.CLICK, x=0.2, y=0.2, thought="Attempt 1"),
            VisualAction(action_type=VisualActionType.CLICK, x=0.25, y=0.25, thought="Attempt 2")
        ])
        agent = VisualQAAgent(sandbox=self.sandbox, provider=provider, scorecard=self.scorecard)

        attempts = [0]
        def verify_on_second():
            attempts[0] += 1
            return attempts[0] >= 2

        res = agent.execute_visual_step("step_retry", "微距重试点击", verify_fn=verify_on_second, max_attempts=3)
        self.assertTrue(res)
        self.assertEqual(attempts[0], 2)

        # 检查是否忠实记录了自愈轨迹
        self.assertEqual(len(self.scorecard.self_healing_events), 1)
        event = self.scorecard.self_healing_events[0]
        self.assertEqual(event.step_name, "step_retry")
        self.assertEqual(event.attempt, 2)
        self.assertTrue(event.resolved)

    def test_execute_visual_step_wait_on(self):
        provider = MockCustomVisionProvider([
            VisualAction(action_type=VisualActionType.WAIT_ON, condition="custom_wait", timeout=1, thought="Wait on event")
        ])
        agent = VisualQAAgent(sandbox=self.sandbox, provider=provider, scorecard=self.scorecard)

        res = agent.execute_visual_step("step_wait", "等待沙盒事件")
        self.assertTrue(res)

    def test_scorecard_reporting(self):
        self.scorecard.record_feature("向导防撞", "引导交互", "PASS", 1.2, "0 遮挡通过")
        self.scorecard.record_risk(VisualRisk(
            category="TEXT_TRUNCATION",
            element_description="Button #btnExport",
            risk_level="LOW",
            details="仅超出 1px"
        ))
        self.scorecard.record_screenshot("shot_1", "/tmp/shot_1.png")

        md = self.scorecard.generate_markdown()
        self.assertIn("向导防撞", md)
        self.assertIn("TEXT_TRUNCATION", md)
        self.assertIn("shot_1", md)

        html = self.scorecard.generate_html()
        self.assertIn("向导防撞", html)
        self.assertIn("shot-card", html)

        self.scorecard.save()
        self.assertTrue(os.path.isfile(os.path.join(self.temp_dir, "visual_audit_scorecard.md")))
        self.assertTrue(os.path.isfile(os.path.join(self.temp_dir, "visual_audit_report.html")))


if __name__ == "__main__":
    unittest.main()
