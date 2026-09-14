# scripts/framework/pipeline/actions.py
"""
Atomic Action Primitives for Gemini Interaction Pipeline.
Each action encapsulates exactly one single-responsibility step with state invariants,
eliminating monolithic multi-step loops, multi-click storms, and premature completion bugs.
"""

import time
import json
from abc import ABC, abstractmethod
from typing import Set, Optional, Dict, Any, Tuple
from dataclasses import dataclass

from .stages import PipelineStage, PipelineConcurrencyViolationError, CircuitBreakerError
from scripts.framework.selectors import GeminiSelectors
from scripts.framework.gateway import get_gateway


@dataclass
class ActionResult:
    success: bool
    message: str
    data: Optional[Dict[str, Any]] = None


class AtomicAction(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @property
    @abstractmethod
    def allowed_stages(self) -> Set[PipelineStage]:
        pass

    @property
    @abstractmethod
    def next_stage(self) -> PipelineStage:
        pass

    @abstractmethod
    def execute(self, ctx: Any, cdp: Any) -> ActionResult:
        pass


class AssertIdleAction(AtomicAction):
    """硬核确保 Gemini 页面处于绝对空闲状态，严禁在前序流式未停时执行任何后续操作"""

    def __init__(self, max_wait: int = 45):
        self.max_wait = max_wait

    @property
    def name(self) -> str:
        return "AssertIdle"

    @property
    def allowed_stages(self) -> Set[PipelineStage]:
        return {PipelineStage.IDLE, PipelineStage.SETTLED, PipelineStage.COOLDOWN}

    @property
    def next_stage(self) -> PipelineStage:
        return PipelineStage.IDLE

    def execute(self, ctx: Any, cdp: Any) -> ActionResult:
        start = time.time()
        while time.time() - start < self.max_wait:
            busy = cdp.eval(f"""
            (() => {{
                const stopBtn = document.querySelector('{GeminiSelectors.STOP_BTN}');
                const isStreaming = !!document.querySelector('{GeminiSelectors.STREAMING_INDICATORS}');
                return !!(stopBtn && stopBtn.offsetWidth > 0) || isStreaming;
            }})()
            """)
            if not busy:
                return ActionResult(True, "页面处于完全空闲状态")
            time.sleep(1.0)

        return ActionResult(False, f"页面在 {self.max_wait}s 内未能恢复空闲 (前序流式或任务尚未结束)")


class StagePromptAction(AtomicAction):
    """原子化注入 Prompt 文本，彻底清空富文本框模型，坚决不触碰发送按钮"""

    def __init__(self, prompt_text: str):
        self.prompt_text = prompt_text

    @property
    def name(self) -> str:
        return f"StagePrompt({self.prompt_text[:20]}...)"

    @property
    def allowed_stages(self) -> Set[PipelineStage]:
        return {PipelineStage.IDLE}

    @property
    def next_stage(self) -> PipelineStage:
        return PipelineStage.STAGED

    def execute(self, ctx: Any, cdp: Any) -> ActionResult:
        # 1. 彻底清空 Quill 编辑器并触发 input 事件
        cdp.eval(f"""
        (() => {{
            const editor = document.querySelector('{GeminiSelectors.EDITOR}');
            if (editor) {{
                editor.focus();
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(editor);
                sel.removeAllRanges();
                sel.addRange(range);
                document.execCommand('delete', false, null);
                if (editor.textContent.trim().length > 0) {{
                    editor.innerHTML = '<p><br></p>';
                    editor.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'deleteContentBackward' }}));
                }}
                editor.dispatchEvent(new Event('input', {{ bubbles: true }}));
            }}
        }})()
        """)
        time.sleep(0.3)

        # 2. 原生输入文本
        cdp.call("Input.insertText", {"text": self.prompt_text})
        time.sleep(0.3)

        # 3. 分发 change/input 事件
        staged_len = cdp.eval(f"""
        (() => {{
            const editor = document.querySelector('{GeminiSelectors.EDITOR}');
            if (editor) {{
                editor.dispatchEvent(new Event('input', {{ bubbles: true }}));
                editor.dispatchEvent(new Event('change', {{ bubbles: true }}));
                return (editor.textContent || '').trim().length;
            }}
            return 0;
        }})()
        """) or 0

        if staged_len > 0:
            return ActionResult(True, f"Prompt 已原子注入输入框 ({staged_len} 字符)")
        return ActionResult(False, "输入框未能成功接收 Prompt 文本")


class SingleClickSendAction(AtomicAction):
    """单次物理点击发送按钮 (Single-Click Guarantee)，绝对不进行多重连击重试循环"""

    @property
    def name(self) -> str:
        return "SingleClickSend"

    @property
    def allowed_stages(self) -> Set[PipelineStage]:
        return {PipelineStage.STAGED}

    @property
    def next_stage(self) -> PipelineStage:
        return PipelineStage.DISPATCHED

    def execute(self, ctx: Any, cdp: Any) -> ActionResult:
        # 严格执行唯一点击通道 (Single Channel of Truth)：
        # 等待发送按钮解除禁用 (最多等待 8 秒，消除 Angular 脏检查与输入渲染时序差)，单次直接调用 sendBtn.click()
        start_wait = time.time()
        while time.time() - start_wait < 8.0:
            click_info = cdp.eval(f"""
            (() => {{
                const sendBtn = document.querySelector('{GeminiSelectors.SEND_BTN}');
                if (sendBtn && !sendBtn.closest('.stop') && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {{
                    const label = (sendBtn.getAttribute('aria-label') || '').toLowerCase();
                    if (!label.includes('stop') && !label.includes('停止')) {{
                        sendBtn.click();
                        return {{ clicked: true }};
                    }}
                }}
                return null;
            }})()
            """)
            if click_info and click_info.get("clicked"):
                return ActionResult(True, "发送按钮单次提交成功派发")
            time.sleep(0.2)

        return ActionResult(False, "未定位到可用且非禁用的发送按钮 (等待 8s 超时)")



class AwaitStreamSettledAction(AtomicAction):
    """
    权威等待流式生成与落盘。
    以扩展网络层真实捕获的 STREAM_COMPLETE 事件为主准绳，图片实体与 DOM 状态为辅助。
    同时内建 Fail-Fast 即刻熔断：遇「You stopped this response」或卡片报错 1 秒内中止，绝不盲等 300 秒。
    """

    def __init__(self, timeout: int = 300, require_image: bool = False, turn_start_time: Optional[float] = None):
        self.timeout = timeout
        self.require_image = require_image
        self.turn_start_time = turn_start_time or time.time()

    @property
    def name(self) -> str:
        return f"AwaitStreamSettled(timeout={self.timeout}s, require_image={self.require_image})"

    @property
    def allowed_stages(self) -> Set[PipelineStage]:
        return {PipelineStage.DISPATCHED, PipelineStage.STREAMING}

    @property
    def next_stage(self) -> PipelineStage:
        return PipelineStage.SETTLED

    def execute(self, ctx: Any, cdp: Any) -> ActionResult:
        start_wait = time.time()
        turn_start_ms = int(self.turn_start_time * 1000)
        last_seen_len = 0
        stable_count = 0

        while time.time() - start_wait < self.timeout:
            time.sleep(1.0)
            elapsed = time.time() - start_wait

            state = cdp.eval(f"""
            (() => {{
                const stopBtn = document.querySelector('{GeminiSelectors.STOP_BTN}');
                const hasStop = !!(stopBtn && stopBtn.offsetWidth > 0);
                const sendBtn = document.querySelector('{GeminiSelectors.SEND_BTN_NOT_STOP}');
                const hasSend = !!(sendBtn && sendBtn.offsetWidth > 0 && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true');
                const editor = document.querySelector('{GeminiSelectors.EDITOR}');
                const isEditorReady = !!(editor && (editor.getAttribute('contenteditable') === 'true' || editor.offsetWidth > 0));
                const isStreamingDOM = !!document.querySelector('{GeminiSelectors.STREAMING_INDICATORS}');

                const streamState = window.__testStreamState || {{}};
                const lastCompleteTime = window.__geminiLastStreamComplete || 0;
                const netCompleted = !!streamState.completed || (lastCompleteTime >= {turn_start_ms});

                const allModels = Array.from(document.querySelectorAll('{GeminiSelectors.MODEL_RESPONSE_ALL}'));
                const currCount = allModels.length;
                const lastModel = currCount > 0 ? allModels[currCount - 1] : null;
                const lastLen = lastModel ? (lastModel.textContent || '').trim().length : 0;
                const lastSnippet = lastModel ? (lastModel.textContent || '').trim().slice(0, 150) : '';
                const hasImages = lastModel ? (lastModel.querySelectorAll('{GeminiSelectors.IMAGES}').length > 0) : false;

                const retryBtn = document.querySelector('{GeminiSelectors.RETRY_BTN}');
                const toastEl = document.querySelector('{GeminiSelectors.TOAST}');

                return {{
                    hasStop,
                    hasSend,
                    isEditorReady,
                    isStreamingDOM,
                    netCompleted,
                    currCount,
                    lastLen,
                    lastSnippet,
                    hasImages,
                    hasRetry: !!retryBtn,
                    toast: toastEl ? toastEl.textContent.trim() : null
                }};
            }})()
            """)

            if not state:
                continue

            # 异常熔断守护 1：若检测到报错 Toast 或 Retry 按钮，严禁盲目自动点击重试，立即熔断！
            if state.get("hasRetry") or state.get("toast"):
                err_text = state.get("toast") or "页面弹出 Retry 重试按钮（服务遇到错误）"
                return ActionResult(False, f"触发熔断停机 (绝不盲目狂点重试): {err_text}")

            last_snippet = (state.get("lastSnippet") or "").lower()
            # 异常熔断守护 2：若卡片内被掐死或打出报错提示，即刻熔断，绝不盲等 300 秒！
            if "you stopped this response" in last_snippet or "你已停止此回复" in last_snippet:
                return ActionResult(False, "检测到回复被异常中断掐死 (You stopped this response)")
            if any(err_kw in last_snippet for err_kw in ["something went wrong", "无法生成图片", "i cannot generate", "unable to process"]):
                return ActionResult(False, f"卡片内显示报错信息: {last_snippet[:60]}")

            has_stop = state.get("hasStop", False)
            has_send = state.get("hasSend", False)
            is_editor_ready = state.get("isEditorReady", False)
            is_stream_dom = state.get("isStreamingDOM", False)
            net_completed = state.get("netCompleted", False)
            last_len = state.get("lastLen", 0)
            has_images = state.get("hasImages", False)

            # 权威判断 1：必须网络层确证完成 + 页面 UI 已脱离忙碌态 + DOM 停止流式
            if net_completed and not has_stop and (has_send or is_editor_ready) and not is_stream_dom:
                if self.require_image:
                    if has_images or elapsed > 45:
                        time.sleep(1.0)
                        return ActionResult(True, f"生图回复完成并落地 (网络确认, 耗时 {elapsed:.1f}s, 检测到图片实体)")
                else:
                    time.sleep(0.5)
                    return ActionResult(True, f"流式回复权威完成 (网络事件确认, 耗时 {elapsed:.1f}s, 字符数: {last_len})")

            # 严格安全兜底 2：在等待超过 15 秒后，若 Stop 消失且 UI 就绪，且图片落地或文本连续 4 次稳定
            if not has_stop and (has_send or is_editor_ready) and not is_stream_dom and elapsed > 15:
                if self.require_image and has_images:
                    time.sleep(1.0)
                    return ActionResult(True, f"生图回复完成并落地 (DOM 图片实体确认, 耗时 {elapsed:.1f}s)")
                elif not self.require_image and last_len > 20:
                    if last_len == last_seen_len:
                        stable_count += 1
                        if stable_count >= 4:
                            time.sleep(0.5)
                            return ActionResult(True, f"流式回复权威完成 (DOM 稳定确认, 耗时 {elapsed:.1f}s, 字符数: {last_len})")
                    else:
                        last_seen_len = last_len
                        stable_count = 0

        return ActionResult(False, f"等待流式完成超时 ({self.timeout}s)")


class HumanCooldownAction(AtomicAction):
    """强制人类阅读节奏冷却期，消除非人类短间隔机械超频发帖特征"""

    def __init__(self, seconds: float = 6.0):
        self.seconds = max(3.0, float(seconds))

    @property
    def name(self) -> str:
        return f"HumanCooldown({self.seconds:.1f}s)"

    @property
    def allowed_stages(self) -> Set[PipelineStage]:
        return {PipelineStage.SETTLED, PipelineStage.IDLE}

    @property
    def next_stage(self) -> PipelineStage:
        return PipelineStage.IDLE

    def execute(self, ctx: Any, cdp: Any) -> ActionResult:
        time.sleep(self.seconds)
        return ActionResult(True, f"人类安全节奏冷却完成 ({self.seconds:.1f}s)")


class ClickNewChatAction(AtomicAction):
    """原子化新建会话"""

    @property
    def name(self) -> str:
        return "ClickNewChat"

    @property
    def allowed_stages(self) -> Set[PipelineStage]:
        return {PipelineStage.IDLE, PipelineStage.SETTLED}

    @property
    def next_stage(self) -> PipelineStage:
        return PipelineStage.IDLE

    def execute(self, ctx: Any, cdp: Any) -> ActionResult:
        try:
            get_gateway().safe_navigate(cdp, "https://gemini.google.com/app")
            time.sleep(2.0)
            return ActionResult(True, "已通过安全网关 safe_navigate 开启新会话")
        except Exception:
            pass
        cdp.eval(f"""
        (() => {{
            const newBtn = document.querySelector('{GeminiSelectors.NEW_CHAT_BTN}');
            if (newBtn) {{
                newBtn.click();
            }} else {{
                window.location.href = 'https://gemini.google.com/app';
            }}
        }})()
        """)
        time.sleep(2.5)
        return ActionResult(True, "已点击开启新会话并加载就绪")


class NavigateChatAction(AtomicAction):
    """原子化导航至指定会话"""

    def __init__(self, chat_id: str):
        self.chat_id = str(chat_id).strip()

    @property
    def name(self) -> str:
        return f"NavigateChat({self.chat_id})"

    @property
    def allowed_stages(self) -> Set[PipelineStage]:
        return {PipelineStage.IDLE, PipelineStage.SETTLED}

    @property
    def next_stage(self) -> PipelineStage:
        return PipelineStage.IDLE

    def execute(self, ctx: Any, cdp: Any) -> ActionResult:
        target_url = f"https://gemini.google.com/app/{self.chat_id}"
        if get_gateway().safe_navigate(cdp, target_url):
            time.sleep(2.0)
            return ActionResult(True, f"已通过安全网关 safe_navigate 导航至会话: {self.chat_id}")
        time.sleep(2.5)
        return ActionResult(True, f"已导航至会话: {self.chat_id}")

