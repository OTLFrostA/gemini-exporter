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
    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        self.model = model or os.environ.get("GEMINI_MODEL") or "gemini-2.0-flash"

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
  "action": "CLICK" | "TYPE" | "PASTE" | "CLEAR" | "KEY" | "WAIT_ON" | "WAIT" | "DONE",
  "box_2d": [ymin, xmin, ymax, xmax], // 0 to 1000 normalized coordinates for CLICK / TYPE target
  "key": "Enter" | "Escape" | "Tab" | "ArrowDown" | "Backspace", // key name for KEY action
  "text": "text to type or paste",
  "condition": "stream_settled" | "zip_downloaded" | "ui_idle" // condition for WAIT_ON
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

                norm_x, norm_y = None, None
                if box and len(box) == 4:
                    ymin, xmin, ymax, xmax = box
                    norm_x = ((xmin + xmax) / 2.0) / 1000.0
                    norm_y = ((ymin + ymax) / 2.0) / 1000.0

                if action_str == "CLICK":
                    if norm_x is None or norm_y is None:
                        return VisualAction(
                            action_type=VisualActionType.FAIL,
                            thought=f"CLICK 缺少有效 box_2d 定位坐标，拒绝盲点击回退: {thought}",
                            details={"raw": parsed}
                        )
                    return VisualAction(
                        action_type=VisualActionType.CLICK,
                        x=norm_x,
                        y=norm_y,
                        thought=thought,
                        details={"box_2d": box} if box else {}
                    )
                elif action_str in ("TYPE", "PASTE"):
                    act_type = VisualActionType.PASTE if action_str == "PASTE" else VisualActionType.TYPE
                    return VisualAction(
                        action_type=act_type,
                        x=norm_x,
                        y=norm_y,
                        text=parsed.get("text", ""),
                        thought=thought
                    )
                elif action_str == "CLEAR":
                    return VisualAction(
                        action_type=VisualActionType.CLEAR,
                        x=norm_x,
                        y=norm_y,
                        thought=thought
                    )
                elif action_str == "KEY":
                    key = parsed.get("key") or parsed.get("text") or "Enter"
                    return VisualAction(
                        action_type=VisualActionType.KEY,
                        key=key,
                        thought=thought
                    )
                elif action_str == "WAIT_ON":
                    cond = parsed.get("condition", "stream_settled")
                    return VisualAction(
                        action_type=VisualActionType.WAIT_ON,
                        condition=cond,
                        timeout=parsed.get("timeout", 300),
                        thought=thought
                    )
                elif action_str == "DONE":
                    return VisualAction(action_type=VisualActionType.DONE, thought=thought)
                elif action_str == "WAIT":
                    return VisualAction(action_type=VisualActionType.WAIT, thought=thought)

                return VisualAction(action_type=VisualActionType.FAIL, thought=f"无法识别动作: {action_str}")
        except Exception as e:
            return VisualAction(action_type=VisualActionType.FAIL, thought=f"Gemini Vision 请求失败: {e}")

    def review_screenshots(self, screenshots: List[Dict[str, Any]]) -> str:
        """
        Multimodal visual UX/UI review for --ai-review.
        Sends key audit snapshots to Gemini Vision to inspect for layout, truncation, collision, and contrast.
        """
        if not self.api_key:
            return "⚠️ 未配置 GEMINI_API_KEY，跳过多模态模型在线视觉审查。"

        if not screenshots:
            return "ℹ️ 本次运行无捕获截屏，跳过视觉审查。"

        # Select up to 4 key snapshots to stay well within payload limits
        selected = screenshots[:4]
        parts = [
            {
                "text": """You are a senior UI/UX visual QA inspector reviewing a web extension's screens.
Analyze the attached UI screenshots and provide a structured visual audit covering:
1. Layout Truncation & Text Overflow (Check if any buttons, badges, or labels are cut off)
2. Visual Occlusion & Collision (Check if popovers, modals, or banners collide with background elements)
3. Dialog & Modal Backdrop (Verify backdrop masks background interaction cleanly)
4. Overall Visual Polish & Recommendations (Rate 1-10 and note any UX risks)

Format your response in concise GitHub-flavored Markdown."""
            }
        ]

        for s in selected:
            path = s.get("path")
            if path and os.path.isfile(path):
                try:
                    with open(path, "rb") as f:
                        img_bytes = f.read()
                    b64 = base64.b64encode(img_bytes).decode("utf-8")
                    parts.append({"text": f"Snapshot: {s.get('name', 'unnamed')}"})
                    parts.append({"inline_data": {"mime_type": "image/png", "data": b64}})
                except Exception as ex:
                    print(f" [⚠️ 警告] 读取审查截屏失败: {path}: {ex}")

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.api_key}"
        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": {"temperature": 0.2}
        }

        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                candidates = result.get("candidates", [])
                if candidates:
                    return candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "（模型未返回分析文本）")
                return "（模型响应中无候选内容）"
        except Exception as e:
            return f"❌ 视觉审查请求失败: {e}"
