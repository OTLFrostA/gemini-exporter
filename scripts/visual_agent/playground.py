# scripts/visual_agent/playground.py
"""
Gemini Exporter — Visual Playground Environment.
Acts as an interactive, hardware-isolated playground for Autonomous AI Agents:
- Pure screenshot perception (zero DOM tree leaks)
- Hardware-grade physical mouse & keyboard actuation (mouseMoved/mousePressed/mouseReleased, KeyA/Backspace/insertText)
- Deterministic blocking wait primitives (`wait_on`), reusing Tier 2 infrastructure
- Viewport distortion protection: always clears device metrics override on teardown
"""

import os
import sys
import time
import json
import base64
import platform
import glob
from dataclasses import dataclass, field
from typing import Optional, Tuple, Dict, Any, List

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from scripts.cdp_client import (
    CDPConnection,
    get_tabs,
    get_extension_id,
    ensure_extension_loaded,
    get_browser_ws_url,
    is_gemini_url,
    CDP_DEFAULT_PORT
)
from scripts.framework.pipeline.actions import (
    AwaitStreamSettledAction,
    AssertIdleAction,
    StreamSettledConfig
)


@dataclass
class ScreenObservation:
    """Raw visual perception result. Absolutely zero DOM tree is exposed."""
    image_bytes: bytes
    b64_data: str
    file_path: str
    viewport: Tuple[int, int]
    timestamp: float
    step_name: str


@dataclass
class WaitResult:
    """Outcome of a blocking wait condition."""
    success: bool
    message: str
    elapsed: float
    data: Dict[str, Any] = field(default_factory=dict)


class VisualPlayground:
    """
    Interactive Visual Playground Environment.
    Exposes only physical sensory and actuator primitives for an Agent:
    1. capture_screen() -> ScreenObservation
    2. mouse_click(x, y)
    3. mouse_scroll(delta_y, x, y)
    4. input_text(text, x, y, clear_first)
    5. wait_on(condition, timeout)
    6. reset(target)
    7. evaluate_export(zip_path)
    """

    def __init__(
        self,
        cdp: CDPConnection,
        viewport_size: Tuple[int, int] = (1280, 800),
        output_dir: Optional[str] = None
    ):
        self.cdp = cdp
        self.viewport_size = viewport_size
        self.width, self.height = viewport_size
        self.output_dir = output_dir or os.path.abspath(
            os.path.join(os.path.dirname(__file__), "../../tests/output/visual_audit")
        )
        os.makedirs(self.output_dir, exist_ok=True)
        self.history: List[Dict[str, Any]] = []
        self._setup_viewport()
        self._setup_download_behavior()

    def _setup_download_behavior(self):
        """Configure browser and page download behavior to save exported archives to output_dir."""
        try:
            self.cdp.call("Page.setDownloadBehavior", {"behavior": "allow", "downloadPath": self.output_dir})
        except Exception:
            pass

    def _setup_viewport(self):
        """Force standardized physical viewport and remove scaling distortions."""
        try:
            self.cdp.call("Emulation.clearDeviceMetricsOverride")
        except Exception:
            pass
        try:
            self.cdp.call("Emulation.setDeviceMetricsOverride", {
                "width": self.width,
                "height": self.height,
                "deviceScaleFactor": 1,
                "mobile": False
            })
        except Exception:
            pass

    def teardown(self):
        """
        Safely tear down the playground:
        Explicitly clear any device metrics overrides to prevent viewport shrinkage bugs,
        and cleanly disconnect the CDP session.
        """
        try:
            self.cdp.call("Emulation.clearDeviceMetricsOverride")
        except Exception:
            pass
        try:
            self.cdp.close()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.teardown()

    def _to_pixel(self, x: float, y: float) -> Tuple[int, int]:
        """Convert normalized (0.0 - 1.0) coordinates to absolute pixels."""
        if 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0:
            px_x = int(round(x * self.width))
            px_y = int(round(y * self.height))
        else:
            px_x = int(round(x))
            px_y = int(round(y))
        px_x = max(0, min(self.width, px_x))
        px_y = max(0, min(self.height, px_y))
        return px_x, px_y

    def capture_screen(self, step_name: Optional[str] = None) -> ScreenObservation:
        """
        Pure visual perception primitive.
        Takes a native CDP screenshot of the current viewport.
        Returns a clean ScreenObservation object containing raw PNG bytes and file path.
        ZERO DOM elements, selectors, or text structures are returned.
        """
        step_name = step_name or f"shot_{int(time.time() * 1000)}"
        res = self.cdp.call("Page.captureScreenshot", {"format": "png"})
        if isinstance(res, dict) and "result" in res and isinstance(res["result"], dict):
            b64_data = res["result"].get("data", "")
        elif isinstance(res, dict):
            b64_data = res.get("data", "")
        else:
            b64_data = ""
        img_bytes = base64.b64decode(b64_data)

        file_path = os.path.join(self.output_dir, f"{step_name}.png")
        with open(file_path, "wb") as f:
            f.write(img_bytes)

        obs = ScreenObservation(
            image_bytes=img_bytes,
            b64_data=b64_data,
            file_path=file_path,
            viewport=(self.width, self.height),
            timestamp=time.time(),
            step_name=step_name
        )
        self.history.append({
            "action": "capture_screen",
            "file": file_path,
            "step_name": step_name,
            "timestamp": obs.timestamp
        })
        return obs

    def mouse_click(self, x: float, y: float, button: str = "left", label: Optional[str] = None):
        """
        Hardware-grade physical mouse click primitive:
        Dispatches standard Input.dispatchMouseEvent:
        1. mouseMoved -> (x, y)
        2. mousePressed -> (x, y)
        3. mouseReleased -> (x, y)
        """
        px_x, px_y = self._to_pixel(x, y)
        btn = "left" if button.lower() == "left" else "right"

        self.cdp.call("Input.dispatchMouseEvent", {
            "type": "mouseMoved",
            "x": px_x,
            "y": px_y
        })
        time.sleep(0.05)

        self.cdp.call("Input.dispatchMouseEvent", {
            "type": "mousePressed",
            "x": px_x,
            "y": px_y,
            "button": btn,
            "clickCount": 1
        })
        time.sleep(0.08)

        self.cdp.call("Input.dispatchMouseEvent", {
            "type": "mouseReleased",
            "x": px_x,
            "y": px_y,
            "button": btn,
            "clickCount": 1
        })
        time.sleep(0.15)

        self.history.append({
            "action": "mouse_click",
            "coords": [px_x, px_y],
            "norm_coords": [x, y],
            "button": btn,
            "label": label,
            "timestamp": time.time()
        })

    def mouse_scroll(self, delta_y: int, x: float = 0.5, y: float = 0.5):
        """Hardware-grade physical mouse wheel event."""
        px_x, px_y = self._to_pixel(x, y)
        self.cdp.call("Input.dispatchMouseEvent", {
            "type": "mouseWheel",
            "x": px_x,
            "y": px_y,
            "deltaX": 0,
            "deltaY": int(delta_y)
        })
        time.sleep(0.2)
        self.history.append({
            "action": "mouse_scroll",
            "delta_y": delta_y,
            "at": [px_x, px_y],
            "timestamp": time.time()
        })

    def input_text(
        self,
        text: str = "",
        x: Optional[float] = None,
        y: Optional[float] = None,
        clear_first: bool = True,
        use_insert: bool = True
    ):
        """
        Hardware-level text input primitive:
        1. Physically clicks (x, y) to gain focus if provided.
        2. Optionally triggers Cmd+A / Ctrl+A + Backspace to clear existing input.
        3. Inserts text via CDP Input.insertText at physical focus.
        """
        if x is not None and y is not None:
            self.mouse_click(x, y, label="focus_for_input")
            time.sleep(0.1)

        if clear_first:
            is_mac = platform.system().lower() == "darwin"
            modifier = 4 if is_mac else 2
            self.cdp.call("Input.dispatchKeyEvent", {
                "type": "rawKeyDown",
                "windowsVirtualKeyCode": 65,
                "key": "a",
                "code": "KeyA",
                "modifiers": modifier
            })
            self.cdp.call("Input.dispatchKeyEvent", {
                "type": "keyUp",
                "windowsVirtualKeyCode": 65,
                "key": "a",
                "code": "KeyA",
                "modifiers": modifier
            })
            time.sleep(0.05)
            self.cdp.call("Input.dispatchKeyEvent", {
                "type": "rawKeyDown",
                "windowsVirtualKeyCode": 8,
                "key": "Backspace",
                "code": "Backspace"
            })
            self.cdp.call("Input.dispatchKeyEvent", {
                "type": "keyUp",
                "windowsVirtualKeyCode": 8,
                "key": "Backspace",
                "code": "Backspace"
            })
            time.sleep(0.1)

        if text:
            if use_insert:
                self.cdp.call("Input.insertText", {"text": text})
            else:
                for ch in text:
                    self.cdp.call("Input.dispatchKeyEvent", {"type": "char", "text": ch})
                    time.sleep(0.02)

        time.sleep(0.15)
        self.history.append({
            "action": "input_text",
            "text": text,
            "timestamp": time.time()
        })

    def wait_on(
        self,
        condition: str,
        timeout: int = 300,
        **kwargs
    ) -> WaitResult:
        """
        Deterministic blocking wait primitive, directly reusing Tier 2 infrastructure.
        The Agent calls this method after dispatching actions (e.g. send prompt or export),
        suspending itself with ZERO token waste while the deterministic engine awaits settlement.
        """
        t0 = time.time()
        cond = condition.lower().strip()

        if cond in ("stream_settled", "stream", "chat_complete"):
            require_image = kwargs.get("require_image", False)
            turn_start_time = kwargs.get("turn_start_time", t0)
            config = kwargs.get("config", None)
            action = AwaitStreamSettledAction(
                timeout=timeout,
                require_image=require_image,
                turn_start_time=turn_start_time,
                config=config
            )
            res = action.execute(None, self.cdp)
            elapsed = time.time() - t0
            return WaitResult(
                success=res.success,
                message=res.message,
                elapsed=elapsed,
                data=res.data or {}
            )

        elif cond in ("ui_idle", "idle"):
            action = AssertIdleAction(max_wait=timeout)
            res = action.execute(None, self.cdp)
            elapsed = time.time() - t0
            return WaitResult(
                success=res.success,
                message=res.message,
                elapsed=elapsed,
                data=res.data or {}
            )

        elif cond in ("zip_downloaded", "export_complete"):
            download_dir = kwargs.get("download_dir") or self.output_dir
            sys_downloads = os.path.expanduser("~/Downloads")
            expected_pattern = kwargs.get("pattern", "gemini_export_*.zip")
            min_mtime = kwargs.get("min_mtime", 0.0)
            start_wait = time.time()

            for _ in range(int(min(timeout, 60))):
                status = self.cdp.eval("""
                (() => {
                    const btn = document.getElementById('btnExport');
                    return { isRunning: btn && btn.disabled };
                })()
                """)
                if not status or not status.get("isRunning"):
                    break
                time.sleep(0.5)

            found_file = None
            while time.time() - start_wait < timeout:
                time.sleep(0.8)
                if os.path.isdir(download_dir):
                    matches = glob.glob(os.path.join(download_dir, expected_pattern))
                    if matches:
                        newest = max(matches, key=os.path.getmtime)
                        if os.path.getmtime(newest) >= min_mtime and os.path.getsize(newest) > 0:
                            found_file = newest
                            break

                if os.path.isdir(sys_downloads):
                    matches = glob.glob(os.path.join(sys_downloads, expected_pattern))
                    if matches:
                        newest = max(matches, key=os.path.getmtime)
                        if os.path.getmtime(newest) >= min_mtime and os.path.getsize(newest) > 0:
                            dest_zip = os.path.join(self.output_dir, os.path.basename(newest))
                            if os.path.abspath(newest) != os.path.abspath(dest_zip):
                                import shutil
                                shutil.copy2(newest, dest_zip)
                                found_file = dest_zip
                            else:
                                found_file = newest
                            break

            elapsed = time.time() - t0
            if found_file:
                return WaitResult(
                    success=True,
                    message=f"ZIP 导出成功落盘: {os.path.basename(found_file)} ({os.path.getsize(found_file)} bytes)",
                    elapsed=elapsed,
                    data={"file_path": found_file, "size": os.path.getsize(found_file)}
                )
            return WaitResult(
                success=False,
                message=f"等待 ZIP 导出落盘超时 ({timeout}s)",
                elapsed=elapsed
            )

        elif cond in ("dom_pruned", "pruned"):
            from scripts.framework.assertions import CDPAssertions
            chat_id = kwargs.get("chat_id", "")
            pruned_ok, pruned_msg, _ = CDPAssertions.assert_dom_pruned(self.cdp, chat_id, timeout=float(timeout))
            elapsed = time.time() - t0
            return WaitResult(
                success=pruned_ok,
                message=pruned_msg,
                elapsed=elapsed
            )

        else:
            time.sleep(min(timeout, 1.0))
            return WaitResult(
                success=True,
                message=f"通用等待完成 ({condition})",
                elapsed=time.time() - t0
            )

    def reset(self, target: str = "options") -> bool:
        """
        Resets the playground to a clean initial state.
        Ensures viewport override is cleared, navigates to target, and waits for idle.
        """
        self._setup_viewport()
        if target.lower() == "options":
            ext_id = get_extension_id(self.cdp)
            if ext_id:
                url = f"chrome-extension://{ext_id}/src/ui/options/options.html"
                self.cdp.call("Page.navigate", {"url": url})
                time.sleep(1.0)
        elif target.lower() == "gemini":
            self.cdp.call("Page.navigate", {"url": "https://gemini.google.com/app"})
            time.sleep(2.0)
        return True

    def evaluate_export(
        self,
        zip_path: str,
        min_conversations: int = 4,
        expected_golden_chats: Optional[List[Dict[str, Any]]] = None
    ) -> Tuple[bool, str, Dict[str, Any]]:
        """Run the comprehensive ExportSpecificationAsserter against a given exported ZIP file."""
        from scripts.framework.assertions import CDPAssertions
        extract_dir = os.path.join(self.output_dir, "extracted_export")
        return CDPAssertions.assert_exported_zip_spec(
            zip_path=zip_path,
            extract_dir=extract_dir,
            min_conversations=min_conversations,
            expected_golden_chats=expected_golden_chats
        )


VisualSandbox = VisualPlayground


def open_visual_playground(
    port: int = CDP_DEFAULT_PORT,
    target_page: str = "options",
    viewport_size: Tuple[int, int] = (1280, 800),
    output_dir: Optional[str] = None
) -> VisualPlayground:
    tabs = get_tabs(port)
    if not tabs:
        raise RuntimeError(f"未在端口 {port} 找到任何活跃 Chrome 标签页。请先启动独立测试 Chrome。")

    target_tab = None
    if target_page.lower() == "gemini":
        target_tab = next((t for t in tabs if is_gemini_url(t.get("url", ""))), None)
    elif target_page.lower() == "options":
        target_tab = next((t for t in tabs if "options.html" in t.get("url", "")), None)

    if not target_tab:
        target_tab = tabs[0]

    cdp = CDPConnection(target_tab["webSocketDebuggerUrl"])
    playground = VisualPlayground(
        cdp=cdp,
        viewport_size=viewport_size,
        output_dir=output_dir
    )
    return playground


open_visual_sandbox = open_visual_playground
