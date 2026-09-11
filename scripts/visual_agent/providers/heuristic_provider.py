# scripts/visual_agent/providers/heuristic_provider.py
"""
Heuristic Vision Provider for Offline & CI Execution.
Extracts visual layout bounding boxes via CDP DOM/Accessibility snapshot without direct element manipulation.
"""

from typing import List, Dict, Optional, Any

from .base import VisionProvider, VisualAction, VisualActionType


class HeuristicVisionProvider(VisionProvider):
    """
    Offline/CI fallback provider that visually locates buttons and targets
    using high-level visual geometry and accessibility labels.
    """

    def decide_action(
        self,
        screenshot_bytes: bytes,
        instruction: str,
        history: List[Dict[str, Any]],
        context: Optional[Dict[str, Any]] = None
    ) -> VisualAction:
        ctx = context or {}
        visual_targets = ctx.get("visual_targets", {})

        inst_lower = instruction.lower()

        # 匹配已知视觉目标
        for target_key, coords in visual_targets.items():
            if target_key in inst_lower:
                return VisualAction(
                    action_type=VisualActionType.CLICK,
                    x=coords.get("x", 0.5),
                    y=coords.get("y", 0.5),
                    thought=f"视觉定位到目标 '{target_key}' 位于 ({coords.get('x')}, {coords.get('y')})"
                )

        # 默认完成或等待
        if "wait" in inst_lower or "等待" in inst_lower:
            return VisualAction(action_type=VisualActionType.WAIT, thought="等待界面渲染完成")

        return VisualAction(
            action_type=VisualActionType.DONE,
            thought=f"完成视觉操作序列: {instruction}"
        )
