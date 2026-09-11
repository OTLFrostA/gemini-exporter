# scripts/visual_agent/engine.py
"""
Physical Visual Execution Engine with Self-Healing Loop.
Captures screenshots, calls VisionProvider, dispatches hardware-level CDP Input events,
and validates visual state transitions with automatic self-healing.
"""

import os
import time
import base64
from typing import Optional, Callable, Dict, Any, List, Tuple

from .providers.base import VisionProvider, VisualAction, VisualActionType
from .scorecard import VisualUXScorecard, SelfHealingEvent, VisualRisk


class VisualExecutionEngine:
    def __init__(self, cdp, provider: VisionProvider, scorecard: VisualUXScorecard, output_dir: str):
        self.cdp = cdp
        self.provider = provider
        self.scorecard = scorecard
        self.output_dir = output_dir
        self.history: List[Dict[str, Any]] = []

    def get_viewport_size(self) -> Tuple[int, int]:
        try:
            res = self.cdp.eval("({ width: window.innerWidth, height: window.innerHeight })")
            return res.get("width", 1280), res.get("height", 800)
        except Exception:
            return 1280, 800

    def capture_screenshot(self, step_name: str) -> Tuple[bytes, str]:
        res = self.cdp.call("Page.captureScreenshot", {"format": "png"})
        b64_data = res.get("result", {}).get("data", "")
        raw_bytes = base64.b64decode(b64_data)
        file_path = os.path.join(self.output_dir, f"{step_name}.png")
        with open(file_path, "wb") as f:
            f.write(raw_bytes)
        self.scorecard.record_screenshot(step_name, file_path)
        return raw_bytes, file_path

    def click_physical(self, x: float, y: float, is_normalized: bool = True):
        width, height = self.get_viewport_size()
        px_x = int(x * width) if is_normalized else int(x)
        px_y = int(y * height) if is_normalized else int(y)

        # 硬件级物理鼠标事件三部曲：mouseMoved -> mousePressed -> mouseReleased
        self.cdp.call("Input.dispatchMouseEvent", {
            "type": "mouseMoved",
            "x": px_x,
            "y": px_y
        })
        time.sleep(0.05)
        self.cdp.call("Input.dispatchMouseEvent", {
            "type": "mousePressed",
            "button": "left",
            "clickCount": 1,
            "x": px_x,
            "y": px_y
        })
        time.sleep(0.05)
        self.cdp.call("Input.dispatchMouseEvent", {
            "type": "mouseReleased",
            "button": "left",
            "clickCount": 1,
            "x": px_x,
            "y": px_y
        })

    def type_physical(self, text: str):
        for char in text:
            self.cdp.call("Input.dispatchKeyEvent", {
                "type": "char",
                "text": char
            })
            time.sleep(0.02)

    def execute_visual_step(
        self,
        step_name: str,
        instruction: str,
        verify_fn: Optional[Callable[[], bool]] = None,
        context: Optional[Dict[str, Any]] = None,
        max_attempts: int = 3
    ) -> bool:
        """
        视觉步骤闭环：看 (Capture) -> 想 (Provider Decide) -> 动 (Physical Dispatch) -> 验 (Verify & Self-Heal)
        """
        t_step_start = time.time()
        for attempt in range(1, max_attempts + 1):
            raw_png, png_path = self.capture_screenshot(f"{step_name}_att_{attempt}")
            action = self.provider.decide_action(raw_png, instruction, self.history, context)

            self.history.append({
                "step": step_name,
                "attempt": attempt,
                "instruction": instruction,
                "action": action.action_type.value,
                "thought": action.thought
            })

            if action.action_type == VisualActionType.CLICK:
                is_norm = (action.x <= 1.0 and action.y <= 1.0)
                self.click_physical(action.x, action.y, is_normalized=is_norm)
            elif action.action_type == VisualActionType.TYPE and action.text:
                self.type_physical(action.text)
            elif action.action_type == VisualActionType.WAIT:
                time.sleep(1.0)

            time.sleep(0.5)

            # 验证动作效果
            if verify_fn:
                try:
                    passed = verify_fn()
                    if passed:
                        if attempt > 1:
                            # 记录成功的自愈事件
                            heal_dur = time.time() - t_step_start
                            self.scorecard.record_self_healing(SelfHealingEvent(
                                step_name=step_name,
                                instruction=instruction,
                                attempt=attempt,
                                reason="初始点击因状态过渡或遮罩延迟未完成转换",
                                action_taken=f"等待 500ms 后重新推算并再次触发物理交互",
                                duration_seconds=heal_dur,
                                resolved=True
                            ))
                        return True
                except Exception as ve:
                    pass

                # 本次未通过，触发自愈退避与记录
                if attempt < max_attempts:
                    heal_dur = time.time() - t_step_start
                    self.scorecard.record_self_healing(SelfHealingEvent(
                        step_name=step_name,
                        instruction=instruction,
                        attempt=attempt,
                        reason="未检测到预期视觉状态跃迁",
                        action_taken="执行退避等待 500ms 并重新感知截屏",
                        duration_seconds=heal_dur,
                        resolved=False
                    ))
                    time.sleep(0.5)
            else:
                return True

        return False
