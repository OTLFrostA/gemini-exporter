# scripts/framework/driver/gemini_driver.py
"""
High-Level Gemini Automation Driver and Chat Session Abstractions.
Encapsulates all low-level CDP interactions, DOM selectors, atomic pipelines,
session lifecycle transitions, and turn evaluations into clean, declarative APIs.
"""

import time
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List, Union

from scripts.framework.actions import CDPActions
from scripts.framework.selectors import GeminiSelectors
from scripts.framework.gateway import get_gateway


@dataclass
class TurnResult:
    """Represents the outcome of a single conversational turn."""
    success: bool
    prompt: str
    model_response: str = ""
    has_images: bool = False
    duration: float = 0.0
    error: Optional[str] = None
    chat_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


class GeminiChatSession:
    """
    High-level abstraction for an active or opened Gemini conversation.
    Tracks conversation turns, identity, and lifecycle operations.
    """

    def __init__(self, driver: "GeminiDriver", chat_id: Optional[str] = None, title: Optional[str] = None):
        self.driver = driver
        self.chat_id = chat_id
        self.title = title
        self.turns: List[TurnResult] = []

    def send_turn(self, prompt: Union[str, Dict[str, Any]], max_wait: int = 300) -> TurnResult:
        """
        Send a conversational prompt to this session, waiting deterministically for stream settlement.
        Extracts the generated response, checks for images, and updates session state.
        """
        t0 = time.time()
        if isinstance(prompt, dict):
            prompt_text = prompt.get("prompt", "")
        else:
            prompt_text = str(prompt)

        p_lower = prompt_text.lower()
        is_image_turn = (
            ("生成" in prompt_text and "图" in prompt_text) or
            any(kw in p_lower for kw in ["画", "生图", "图片", "image", "draw", "imagen", "photo", "picture", "illustration"])
        )
        wait_timeout = max(max_wait, 240) if is_image_turn else max_wait

        # 执行单飞原子流水线发帖
        ok, msg = CDPActions.send_gemini_turn(self.driver.cdp, prompt, max_wait=wait_timeout)
        duration = time.time() - t0

        if not ok:
            err_res = TurnResult(
                success=False,
                prompt=prompt_text,
                duration=duration,
                error=msg,
                chat_id=self.chat_id
            )
            self.turns.append(err_res)
            return err_res

        # 刷新/补全会话 ID
        curr_id = self.driver.get_current_chat_id()
        if curr_id:
            self.chat_id = curr_id

        # 提取最新回复文本与生图实体
        resp_data = self.driver.cdp.eval(f"""
        (() => {{
            const models = Array.from(document.querySelectorAll('{GeminiSelectors.MODEL_RESPONSE}'));
            if (models.length === 0) return {{ text: '', hasImages: false, modelCount: 0 }};
            const last = models[models.length - 1];
            const text = (last.textContent || '').trim();
            const imgs = last.querySelectorAll('{GeminiSelectors.IMAGES}');
            return {{
                text: text,
                hasImages: imgs.length > 0,
                modelCount: models.length
            }};
        }})()
        """) or {}

        # 若为生图轮次但初检尚未渲染完成，给予短暂渲染等待
        has_images = bool(resp_data.get("hasImages", False))
        if is_image_turn and not has_images:
            for _ in range(5):
                time.sleep(2.0)
                img_check = self.driver.cdp.eval(f"""
                (() => {{
                    const models = Array.from(document.querySelectorAll('{GeminiSelectors.MODEL_RESPONSE}'));
                    const root = models.length > 0 ? models[models.length - 1] : document;
                    const imgs = root.querySelectorAll('{GeminiSelectors.IMAGES}');
                    return imgs.length > 0;
                }})()
                """)
                if img_check:
                    has_images = True
                    break

        turn_res = TurnResult(
            success=True,
            prompt=prompt_text,
            model_response=resp_data.get("text", ""),
            has_images=has_images,
            duration=duration,
            chat_id=self.chat_id,
            metadata={"model_count": resp_data.get("modelCount", 1)}
        )
        self.turns.append(turn_res)
        return turn_res

    def delete_via_web(self, timeout: float = 15.0) -> bool:
        """在侧边栏触发网页原生删除流程"""
        chat_id = self.chat_id or self.driver.get_current_chat_id()
        if not chat_id:
            return False
        return CDPActions.delete_conversation_via_web(self.driver.cdp, chat_id)

    def get_title(self) -> str:
        """获取当前会话权威标题"""
        t = CDPActions.get_current_chat_title(self.driver.cdp)
        if t:
            self.title = t
        return self.title or ""


class GeminiDriver:
    """
    High-Level Automation Driver for Google Gemini.
    Manages session lifecycle, model validation, and route switching.
    """

    def __init__(self, cdp: Any):
        self.cdp = cdp
        self.active_session: Optional[GeminiChatSession] = None

    def ensure_ready(self, timeout: float = 20.0) -> bool:
        """等待 Gemini 页面核心输入框与 DOM 挂载就绪"""
        return CDPActions.wait_for_gemini_ready(self.cdp, max_wait=int(timeout))

    def ensure_model(self, target_model: str = "3.8 Flash", target_thinking: bool = True, force_menu_check: bool = False) -> bool:
        """保证模型为 3.8 Flash 并开启深度思考"""
        return CDPActions.ensure_model_and_thinking(
            self.cdp,
            target_model=target_model,
            target_thinking=target_thinking,
            force_menu_check=force_menu_check
        )

    def get_current_chat_id(self) -> Optional[str]:
        """提取当前对话 ID"""
        return CDPActions.get_current_chat_id(self.cdp)

    def get_current_chat_title(self) -> Optional[str]:
        """提取当前对话标题"""
        return CDPActions.get_current_chat_title(self.cdp)

    def new_chat(self, timeout: float = 20.0) -> GeminiChatSession:
        """
        开启全新对话并等待绝对确定性就绪：
        1. 路径跳转回 /app
        2. 历史气泡物理清空 (0 计数)
        3. 输入框就绪
        4. 模型与 Thinking 就绪
        """
        CDPActions.click_new_chat(self.cdp)

        start_t = time.time()
        while time.time() - start_t < timeout:
            state = self.cdp.eval(f"""
            (() => {{
                const path = window.location.pathname || '';
                const isAppRoute = (path === '/app' || path === '/app/');
                const bubbleCount = document.querySelectorAll('{GeminiSelectors.USER_QUERY}, {GeminiSelectors.MODEL_RESPONSE}').length;
                const editor = document.querySelector('{GeminiSelectors.EDITOR}');
                return {{
                    isAppRoute,
                    bubbleCount,
                    hasEditor: !!editor
                }};
            }})()
            """)
            if state and state.get("isAppRoute") and state.get("bubbleCount") == 0 and state.get("hasEditor"):
                break
            time.sleep(0.5)

        self.ensure_model(target_model="3.8 Flash", target_thinking=True, force_menu_check=False)

        session = GeminiChatSession(driver=self, chat_id=None)
        self.active_session = session
        return session

    def open_chat(self, chat_id: str, timeout: float = 20.0) -> GeminiChatSession:
        """
        导航至已有会话并等待就绪
        """
        chat_id_clean = str(chat_id).strip()
        curr_id = self.get_current_chat_id()
        if curr_id != chat_id_clean:
            target_url = f"https://gemini.google.com/app/{chat_id_clean}"
            get_gateway().safe_navigate(self.cdp, target_url)
            time.sleep(2.0)

        start_t = time.time()
        while time.time() - start_t < timeout:
            state = self.cdp.eval(f"""
            (() => {{
                const path = window.location.pathname || '';
                const onPath = path.includes('{chat_id_clean}');
                const editor = document.querySelector('{GeminiSelectors.EDITOR}');
                return onPath && !!editor;
            }})()
            """)
            if state:
                break
            time.sleep(0.5)

        self.ensure_model(target_model="3.8 Flash", target_thinking=True, force_menu_check=False)

        session = GeminiChatSession(driver=self, chat_id=chat_id_clean)
        self.active_session = session
        return session
