# tests/test_framework_environment.py
"""
Unit tests for Tier 2 TestEnvironment (scripts/framework/environment.py).
Validates:
- Unified environment lifecycle initialization (reinstall, tab discovery, viewport, download)
- Gemini and Options tab resolution and WebSocket debugger URL connection
- Viewport standardization (1280x800) and cleanup
- TestContext and VisualPlayground delegation
"""

import os
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from scripts.framework.environment import TestEnvironment, EnvironmentContext


from scripts.framework.assertions import CDPAssertions


class TestPdfMathAssertion(unittest.TestCase):
    def test_normal_latex_prose_and_code_are_not_renderer_fallbacks(self):
        for text in ("Use LaTeX and state the units of every parameter.",
                     r"LaTeX \frac{1}{2} in a tutorial code example"):
            with self.subTest(text=text):
                self.assertEqual(CDPAssertions.assert_pdf_math_compiled(text), (True, ""))

    def test_real_renderer_fallback_preserves_failure_and_formula_context(self):
        for label in ("Could not typeset this formula; original LaTeX preserved:",
                      "\u65e0\u6cd5\u6392\u7248\u8be5\u516c\u5f0f\uff1b\u4fdd\u7559\u539f\u59cb LaTeX\uff1a"):
            formula = r"\Lambda(X) \gtrso_{D_0}^{D_1} \gamma"
            passed, context = CDPAssertions.assert_pdf_math_compiled(label + formula)
            self.assertFalse(passed)
            self.assertIn(formula, context)

    def test_fallback_label_survives_extraction_whitespace(self):
        self.assertFalse(CDPAssertions.assert_pdf_math_compiled(
            "Couldnottypesetthis\nformula; original LaTeX preserved:" )[0])
        self.assertFalse(CDPAssertions.assert_pdf_math_compiled(
            "\u65e0 \u6cd5\u6392\n\u7248\u8be5\u516c\u5f0f")[0])


class MockCDP:
    def __init__(self, ws_url="ws://127.0.0.1:9222/devtools/page/mock1"):
        self.ws_url = ws_url
        self.calls = []
        self.evals = []
        self.closed = False

    def call(self, method, params=None):
        self.calls.append({"method": method, "params": params or {}})
        if method == "Extensions.loadUnpacked":
            return {"result": {"id": "mock_unpacked_id"}}
        return {}

    def eval(self, expr, await_promise=False):
        self.evals.append(expr)
        return None

    def close(self):
        self.closed = True


class TestFrameworkEnvironment(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.env = TestEnvironment(
            port=9222,
            output_dir=self.temp_dir,
            viewport_size=(1280, 800)
        )

    def tearDown(self):
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_environment_initialization_defaults(self):
        self.assertEqual(self.env.port, 9222)
        self.assertEqual(self.env.viewport_size, (1280, 800))
        self.assertEqual(self.env.output_dir, self.temp_dir)
        self.assertTrue(os.path.isdir(self.env.output_dir))
        self.assertIsNone(self.env.ext_id)

    @patch("scripts.framework.environment.CDPActions.reinstall_extension")
    def test_reinstall_extension_updates_ext_id(self, mock_reinstall):
        mock_reinstall.return_value = "new_test_ext_id"
        result = self.env.reinstall_extension()
        self.assertEqual(result, "new_test_ext_id")
        self.assertEqual(self.env.ext_id, "new_test_ext_id")
        self.assertEqual(self.env.get_extension_id(), "new_test_ext_id")
        mock_reinstall.assert_called_once_with(port=9222, repo_path=self.env.repo_path)

    @patch("scripts.framework.environment.get_tabs")
    @patch("scripts.framework.environment.CDPActions.reinstall_extension", return_value=None)
    def test_failed_reinstall_aborts_before_opening_tabs(self, mock_reinstall, mock_get_tabs):
        with self.assertRaisesRegex(RuntimeError, "扩展安装失败"):
            self.env.init_environment(reinstall=True, target_pages=("gemini", "options"),
                                      active_target="options", setup_download=False)
        self.assertIsNone(self.env.ext_id, "a failed reinstall must not report an active extension")
        mock_reinstall.assert_called_once()
        mock_get_tabs.assert_not_called()

    @patch("scripts.framework.environment.get_tabs")
    def test_tab_discovery(self, mock_get_tabs):
        mock_get_tabs.return_value = [
            {"type": "webview", "url": "https://gemini.google.com/glic?hl=zh-CN", "webSocketDebuggerUrl": "ws://mock/glic"},
            {"type": "page", "url": "https://gemini.google.com/app", "webSocketDebuggerUrl": "ws://mock/gemini"},
            {"type": "page", "url": "chrome-extension://test_id/src/ui/options/options.html", "webSocketDebuggerUrl": "ws://mock/options"}
        ]
        self.env.ext_id = "test_id"

        gemini_tab = self.env.get_gemini_tab()
        self.assertIsNotNone(gemini_tab)
        self.assertEqual(gemini_tab["webSocketDebuggerUrl"], "ws://mock/gemini")

        options_tab = self.env.get_options_tab()
        self.assertIsNotNone(options_tab)
        self.assertEqual(options_tab["webSocketDebuggerUrl"], "ws://mock/options")

        # ensure_tab logic resolution
        self.assertEqual(self.env.ensure_tab("gemini")["webSocketDebuggerUrl"], "ws://mock/gemini")
        self.assertEqual(self.env.ensure_tab("chat")["webSocketDebuggerUrl"], "ws://mock/gemini")
        self.assertEqual(self.env.ensure_tab("options")["webSocketDebuggerUrl"], "ws://mock/options")
        self.assertEqual(self.env.ensure_tab("workbench")["webSocketDebuggerUrl"], "ws://mock/options")

    @patch("scripts.framework.environment.get_tabs")
    def test_extension_pages_never_fall_back_to_foreign_tabs(self, mock_get_tabs):
        self.env.ext_id = "current_id"
        for kind in ("options", "popup"):
            with self.subTest(kind=kind):
                path = f"/src/ui/{kind}/{kind}.html"
                mock_get_tabs.return_value = [
                    {"url": f"chrome-extension://old_id{path}"},
                    {"url": f"https://example.com/?next=chrome-extension://current_id{path}"},
                    {"url": f"chrome-extension://current_id{path}.old"},
                    {"type": "service_worker", "url": f"chrome-extension://current_id{path}"},
                ]
                get_tab = getattr(self.env, f"get_{kind}_tab")
                self.assertIsNone(get_tab())
                current = {"type": "page", "url": f"chrome-extension://current_id{path}?test=1#ready"}
                mock_get_tabs.return_value.append(current)
                self.assertIs(get_tab(), current)

    @patch("scripts.framework.environment.urllib.request.urlopen")
    @patch("scripts.framework.environment.get_extension_id", return_value=None)
    def test_unknown_extension_does_not_open_relative_pages(self, mock_id, mock_open):
        self.assertIsNone(self.env.ensure_options_tab())
        self.assertIsNone(self.env.ensure_popup_tab())
        mock_open.assert_not_called()

    @patch("scripts.framework.environment.time.sleep")
    @patch("scripts.framework.environment.urllib.request.urlopen")
    @patch("scripts.framework.environment.get_tabs")
    def test_foreign_options_tab_causes_current_extension_page_creation(self, mock_tabs, mock_open, mock_sleep):
        self.env.ext_id = "current_id"
        mock_tabs.return_value = [{"url": "chrome-extension://old_id/src/ui/options/options.html"}]
        created = {"id": "new", "url": "chrome-extension://current_id/src/ui/options/options.html"}
        import json
        mock_open.return_value.__enter__.return_value.read.return_value = json.dumps(created).encode()
        self.assertEqual(self.env.ensure_options_tab(), created)
        request = mock_open.call_args.args[0]
        self.assertEqual(request.full_url, "http://127.0.0.1:9222/json/new?" + created["url"])
        self.assertEqual(request.method, "PUT")

    def test_setup_and_clear_viewport(self):
        mock_cdp = MockCDP()
        self.env.setup_viewport(mock_cdp, (1920, 1080))
        methods = [c["method"] for c in mock_cdp.calls]
        self.assertIn("Emulation.clearDeviceMetricsOverride", methods)
        self.assertIn("Emulation.setDeviceMetricsOverride", methods)
        set_override = next(c for c in mock_cdp.calls if c["method"] == "Emulation.setDeviceMetricsOverride")
        self.assertEqual(set_override["params"]["width"], 1920)
        self.assertEqual(set_override["params"]["height"], 1080)
        self.assertEqual(set_override["params"]["deviceScaleFactor"], 1)
        self.assertEqual(set_override["params"]["mobile"], False)

        # clear viewport
        self.env.clear_viewport(mock_cdp)
        self.assertEqual(mock_cdp.calls[-1]["method"], "Emulation.clearDeviceMetricsOverride")

    @patch("scripts.framework.environment.get_browser_ws_url")
    @patch("scripts.framework.environment.CDPConnection")
    def test_setup_download_behavior(self, mock_conn, mock_browser_ws):
        mock_browser_cdp = MockCDP()
        mock_conn.return_value = mock_browser_cdp
        mock_browser_ws.return_value = "ws://mock/browser"

        page_cdp = MockCDP()
        self.env.setup_download_behavior(output_dir=self.temp_dir, cdp=page_cdp)

        browser_calls = [c for c in mock_browser_cdp.calls if c["method"] == "Browser.setDownloadBehavior"]
        self.assertEqual(browser_calls, [{
            "method": "Browser.setDownloadBehavior",
            "params": {"behavior": "allow", "downloadPath": self.temp_dir, "eventsEnabled": True},
        }])

        page_calls = [c for c in page_cdp.calls if c["method"] == "Page.setDownloadBehavior"]
        self.assertEqual(page_calls, [{
            "method": "Page.setDownloadBehavior",
            "params": {"behavior": "allow", "downloadPath": self.temp_dir},
        }])

    @patch("scripts.framework.environment.get_browser_ws_url", return_value=None)
    def test_download_configuration_uses_page_transport_when_browser_websocket_is_unavailable(self, mock_browser_ws):
        page = MockCDP()
        self.env.setup_download_behavior(cdp=page)
        self.assertEqual(self.env.browser_cdp, None)
        self.assertEqual(
            [call["params"]["downloadPath"] for call in page.calls if call["method"] == "Page.setDownloadBehavior"],
            [self.temp_dir],
        )
        self.assertGreaterEqual(mock_browser_ws.call_count, 1, 'browser discovery must have been attempted')

    @patch("scripts.framework.environment.CDPActions.reinstall_extension")
    @patch("scripts.framework.environment.get_tabs")
    @patch("scripts.framework.environment.CDPConnection")
    def test_init_environment_full_pipeline(self, mock_conn, mock_get_tabs, mock_reinstall):
        mock_reinstall.return_value = "pipeline_ext_id"
        mock_get_tabs.return_value = [
            {"url": "https://gemini.google.com/app", "webSocketDebuggerUrl": "ws://mock/gemini"},
            {"url": "chrome-extension://pipeline_ext_id/src/ui/options/options.html", "webSocketDebuggerUrl": "ws://mock/options"}
        ]
        mock_cdp = MockCDP()
        mock_conn.return_value = mock_cdp

        ctx = self.env.init_environment(
            reinstall=True,
            target_pages=("gemini", "options"),
            active_target="options",
            reload_gemini=True,
            setup_viewport=True,
            setup_download=False
        )

        self.assertIsInstance(ctx, EnvironmentContext)
        self.assertEqual(ctx.ext_id, "pipeline_ext_id")
        self.assertIsNotNone(ctx.gemini_tab)
        self.assertIsNotNone(ctx.options_tab)
        self.assertEqual(ctx.active_tab, ctx.options_tab, "active_target=options must select this extension's workbench")
        self.assertIs(ctx.active_cdp, mock_cdp)
        self.assertTrue(any("location.reload()" in expr for expr in mock_cdp.evals),
                        "reinstall+reload_gemini must execute a real CDP reload")
        viewport = [call["params"] for call in mock_cdp.calls
                    if call["method"] == "Emulation.setDeviceMetricsOverride"]
        self.assertEqual(viewport, [{
            "width": 1280, "height": 800, "deviceScaleFactor": 1, "mobile": False,
        }])
        self.assertFalse(any("DownloadBehavior" in call["method"] for call in mock_cdp.calls),
                         "setup_download=False must not configure download behavior")
        mock_reinstall.assert_called_once_with(port=9222, repo_path=self.env.repo_path)

    def test_teardown_cleans_viewport_and_closes_connection(self):
        mock_cdp = MockCDP()
        self.env.teardown(mock_cdp)
        self.assertTrue(mock_cdp.closed)
        methods = [c["method"] for c in mock_cdp.calls]
        self.assertIn("Emulation.clearDeviceMetricsOverride", methods)


if __name__ == "__main__":
    unittest.main()
