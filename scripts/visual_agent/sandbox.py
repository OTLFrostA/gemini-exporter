# scripts/visual_agent/sandbox.py
"""
Pure Physical Visual Sandbox for Autonomous Visual QA Agents.
Provides hardware-isolated interaction primitives:
- Pure screenshot perception (zero DOM exposure)
- Hardware-grade physical mouse & keyboard actuation (zero JS click/value cheats)
- Deterministic blocking wait primitives (`wait_on`), reusing Tier 2 infrastructure
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


class VisualSandbox:
    """
    Physical Visual Sandbox.
    Acts as an opaque game-like environment for an Autonomous Visual Agent.
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
        """Clean up CDP emulation overrides to restore full viewport layout."""
        try:
            self.cdp.call("Emulation.clearDeviceMetricsOverride")
        except Exception:
            pass

    def _to_pixel(self, x: float, y: float) -> Tuple[int, int]:
        """Convert normalized (0.0~1.0) or absolute pixel coordinates to device pixels."""
        px_x = int(x * self.width) if (0.0 <= x <= 1.0) else int(x)
        px_y = int(y * self.height) if (0.0 <= y <= 1.0) else int(y)
        px_x = max(0, min(px_x, self.width - 1))
        px_y = max(0, min(px_y, self.height - 1))
        return px_x, px_y

    def capture_screen(self, step_name: str = "screen") -> ScreenObservation:
        """
        Primary visual observation primitive.
        Returns high-resolution PNG screenshot with zero DOM leaking.
        """
        self._setup_viewport()
        res = self.cdp.call("Page.captureScreenshot", {"format": "png"})
        b64 = res.get("result", {}).get("data", "")
        raw_bytes = base64.b64decode(b64)

        file_path = os.path.join(self.output_dir, f"{step_name}.png")
        with open(file_path, "wb") as f:
            f.write(raw_bytes)

        obs = ScreenObservation(
            image_bytes=raw_bytes,
            b64_data=b64,
            file_path=file_path,
            viewport=(self.width, self.height),
            timestamp=time.time(),
            step_name=step_name
        )
        self.history.append({
            "action": "capture_screen",
            "step_name": step_name,
            "timestamp": obs.timestamp,
            "file_path": file_path
        })
        return obs

    def mouse_click(
        self,
        x: float,
        y: float,
        button: str = "left",
        click_count: int = 1,
        label: str = "click"
    ):
        """
        Hardware-grade physical mouse click sequence:
        mouseMoved (triggers :hover) -> mousePressed -> mouseReleased
        """
        px_x, px_y = self._to_pixel(x, y)

        # 1. 物理移动光标
        self.cdp.call("Input.dispatchMouseEvent", {
            "type": "mouseMoved",
            "x": px_x,
            "y": px_y
        })
        time.sleep(0.06)

        # 2. 物理按下按键
        self.cdp.call("Input.dispatchMouseEvent", {
            "type": "mousePressed",
            "button": button,
            "clickCount": click_count,
            "x": px_x,
            "y": px_y
        })
        time.sleep(0.06)

        # 3. 物理释放按键
        self.cdp.call("Input.dispatchMouseEvent", {
            "type": "mouseReleased",
            "button": button,
            "clickCount": click_count,
            "x": px_x,
            "y": px_y
        })
        time.sleep(0.2)

        self.history.append({
            "action": "mouse_click",
            "label": label,
            "coords": [px_x, px_y],
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
        time.sleep(0.3)
        self.history.append({
            "action": "mouse_scroll",
            "delta_y": delta_y,
            "at": [px_x, px_y],
            "timestamp": time.time()
        })

    def input_text(
        self,
        x: Optional[float] = None,
        y: Optional[float] = None,
        text: str = "",
        clear_first: bool = False,
        use_insert: bool = True
    ):
        """
        Hardware-level text input primitive:
        1. Physically clicks (x, y) to gain focus if provided.
        2. Optionally triggers Cmd+A / Ctrl+A + Backspace to clear.
        3. Inserts text via hardware keyboard events or CDP Input.insertText at focus.
        """
        if x is not None and y is not None:
            self.mouse_click(x, y, label="focus_for_input")
            time.sleep(0.1)

        if clear_first:
            is_mac = platform.system().lower() == "darwin"
            modifier = 4 if is_mac else 2  # Command (4) or Control (2)
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

        if use_insert:
            # 原生向当前焦点插入文本，完全模拟剪贴板粘贴行为，绝对不修改 DOM 元素属性
            self.cdp.call("Input.insertText", {"text": text})
        else:
            for ch in text:
                self.cdp.call("Input.dispatchKeyEvent", {"type": "char", "text": ch})
                time.sleep(0.02)

        time.sleep(0.2)
        self.history.append({
            "action": "input_text",
            "text_length": len(text),
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
        The Agent calls this method after dispatching actions (e.g. send or export),
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

            # 1. 监控并等待导出引擎完成打包 (btnExport 恢复可用且 disabled=false)
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
                # 优先检查目标 output_dir
                if os.path.isdir(download_dir):
                    matches = glob.glob(os.path.join(download_dir, expected_pattern))
                    if matches:
                        newest = max(matches, key=os.path.getmtime)
                        if os.path.getmtime(newest) >= min_mtime and os.path.getsize(newest) > 0:
                            found_file = newest
                            break

                # 检查系统默认 ~/Downloads
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
            time.sleep(min(5.0, float(timeout)))
            return WaitResult(
                success=True,
                message=f"通用等待完成 ({condition})",
                elapsed=time.time() - t0
            )


def open_visual_sandbox(
    port: int = CDP_DEFAULT_PORT,
    repo_path: Optional[str] = None,
    target_url: Optional[str] = None,
    output_dir: Optional[str] = None
) -> Tuple[VisualSandbox, str]:
    """
    Factory function to initialize and connect a VisualSandbox to Chrome.
    Ensures extension is loaded, navigates to the options workbench, and returns (sandbox, ext_id).
    """
    repo_path = os.path.abspath(repo_path or os.path.join(os.path.dirname(__file__), "../.."))
    eid = ensure_extension_loaded(port=port, repo_path=repo_path)
    if not eid:
        raise RuntimeError("无法在指定 Chrome 调试端口上找到或挂载 Gemini Exporter 扩展！")

    options_page_url = target_url or f"chrome-extension://{eid}/src/ui/options/options.html"

    tabs = get_tabs(port)
    opt_tab = next((t for t in tabs if t.get("type") == "page" and f"chrome-extension://{eid}" in t.get("url", "") and "options.html" in t.get("url", "")), None)

    if not opt_tab:
        reuse_tab = next((t for t in tabs if t.get("type") == "page" and not is_gemini_url(t.get("url", "")) and "tally.so" not in t.get("url", "")), None)
        if reuse_tab:
            cdp = CDPConnection(reuse_tab["webSocketDebuggerUrl"])
            cdp.call("Page.navigate", {"url": options_page_url})
            cdp.close()
            opt_tab = reuse_tab
        else:
            import urllib.request
            new_url = f"http://127.0.0.1:{port}/json/new?{options_page_url}"
            req = urllib.request.Request(new_url, method="PUT")
            with urllib.request.urlopen(req, timeout=5) as r:
                opt_tab = json.loads(r.read().decode("utf-8"))

    time.sleep(1.0)
    cdp = CDPConnection(opt_tab["webSocketDebuggerUrl"])
    sandbox = VisualSandbox(cdp=cdp, output_dir=output_dir)
    return sandbox, eid
