# scripts/visual_agent/providers/gemini_vision_provider.py
"""
Gemini Vision Provider for Visual Agent Testing.
Uses Gemini multimodal model to visually ground UI elements from screenshots.
"""

import os
import re
import json
import base64
import urllib.request
from typing import List, Dict, Optional, Any

from .base import VisionProvider, VisualAction, VisualActionType


class GeminiVisionProvider(VisionProvider):
    def __init__(self, api_key: Optional[str] = None, model: str = "gemini-2.0-flash"):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        self.model = model

    def decide_action(
        self,
        screenshot_bytes: bytes,
        instruction: str,
        history: List[Dict[str, Any]],
        context: Optional[Dict[str, Any]] = None
    ) -> VisualAction:
        if not self.api_key:
            return VisualAction(
                action_type=VisualActionType.FAIL,
                thought="未配置 GEMINI_API_KEY，无法调用远程 Gemini Vision 模型"
            )

        b64_image = base64.b64encode(screenshot_bytes).decode("utf-8")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.api_key}"

        prompt = f"""
You are an autonomous AI UI testing agent interacting with a Chrome extension web interface.
Current User Instruction: "{instruction}"

Previous Actions:
{json.dumps(history[-3:] if history else [], ensure_ascii=False, indent=2)}

Look at the provided screenshot carefully.
Determine the single best physical mouse or keyboard action to fulfill the instruction.

Return ONLY a JSON object formatted exactly as:
{{
  "thought": "brief explanation of what you see and what you will do",
  "action": "CLICK" | "TYPE" | "SCROLL" | "WAIT" | "DONE",
  "box_2d": [ymin, xmin, ymax, xmax], // 0 to 1000 normalized coordinates for CLICK
  "text": "text to type if action is TYPE"
}}
"""

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {
                            "inline_data": {
                                "mime_type": "image/png",
                                "data": b64_image
                            }
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.1,
                "response_mime_type": "application/json"
            }
        }

        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                candidates = result.get("candidates", [])
                if not candidates:
                    return VisualAction(action_type=VisualActionType.FAIL, thought="Gemini Vision 无候选响应")

                raw_text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                parsed = json.loads(raw_text)

                action_str = parsed.get("action", "CLICK").upper()
                thought = parsed.get("thought", "")
                box = parsed.get("box_2d")

                if action_str == "CLICK" and box and len(box) == 4:
                    ymin, xmin, ymax, xmax = box
                    # 转换 0-1000 至 0.0 - 1.0 归一化中心点
                    norm_x = ((xmin + xmax) / 2.0) / 1000.0
                    norm_y = ((ymin + ymax) / 2.0) / 1000.0
                    return VisualAction(
                        action_type=VisualActionType.CLICK,
                        x=norm_x,
                        y=norm_y,
                        thought=thought,
                        details={"box_2d": box}
                    )
                elif action_str == "TYPE":
                    return VisualAction(
                        action_type=VisualActionType.TYPE,
                        text=parsed.get("text", ""),
                        thought=thought
                    )
                elif action_str == "DONE":
                    return VisualAction(action_type=VisualActionType.DONE, thought=thought)
                elif action_str == "WAIT":
                    return VisualAction(action_type=VisualActionType.WAIT, thought=thought)

                return VisualAction(action_type=VisualActionType.FAIL, thought=f"无法识别动作: {action_str}")
        except Exception as e:
            return VisualAction(action_type=VisualActionType.FAIL, thought=f"Gemini Vision 请求失败: {e}")
