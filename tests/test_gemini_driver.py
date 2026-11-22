# tests/test_gemini_driver.py
"""
Tests for GeminiDriver, GeminiChatSession, and TurnResult abstractions.
Validates declarative interaction model, turn encapsulation, and state isolation.
"""

import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, call, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from scripts.cdp_client import CDPConnection, get_tabs
from scripts.framework.driver import GeminiDriver, GeminiChatSession, TurnResult


class MockCDP:
    """Mock CDP connection for driver unit testing."""
    def __init__(self):
        self.eval_responses = []
        self.calls = []

    def eval(self, script: str):
        self.calls.append(("eval", script))
        if self.eval_responses:
            return self.eval_responses.pop(0)
        return None

    def call(self, method: str, params=None):
        self.calls.append(("call", method, params))
        return {}

    def reconnect(self):
        self.calls.append(("reconnect",))


class TestGeminiDriverSuite(unittest.TestCase):

    def test_auto_mode_waits_for_picker_and_retries_opening(self):
        cdp = MockCDP()
        cdp.eval_responses = ["opened", "waiting", "opened", "selected"]
        with patch("scripts.framework.driver.gemini_driver.time.sleep"), \
             patch("scripts.framework.driver.gemini_driver.time.monotonic", side_effect=[0, 0, 0.25, 1, 1.25]):
            self.assertTrue(GeminiDriver(cdp).ensure_auto_mode())
        scripts = [script for kind, script, *_ in cdp.calls if kind == "eval"]
        self.assertIn("if (!true ||", scripts[0])
        self.assertIn("if (!false ||", scripts[1])
        self.assertIn("if (!true ||", scripts[2])
        self.assertEqual(cdp.calls[0], ("call", "Emulation.setFocusEmulationEnabled", {"enabled": True}))
        keys = [args[1]["key"] for kind, *args in cdp.calls
                if kind == "call" and args[0] == "Input.dispatchKeyEvent"]
        self.assertEqual(keys, ["Escape", "Escape"])

    def test_auto_mode_reopens_picker_to_verify_change(self):
        cdp = MockCDP()
        cdp.eval_responses = ["opened", "choosing", "opened", "selected"]
        with patch("scripts.framework.driver.gemini_driver.time.sleep"), \
             patch("scripts.framework.driver.gemini_driver.time.monotonic", side_effect=[0, 0, 0.25, 0.5, 0.75]):
            self.assertTrue(GeminiDriver(cdp).ensure_auto_mode())
        scripts = [script for kind, script, *_ in cdp.calls if kind == "eval"]
        self.assertIn("if (true)", scripts[1])
        self.assertIn("if (!true ||", scripts[2])
        self.assertIn("if (false)", scripts[3])
        self.assertFalse(cdp.eval_responses)

    def test_auto_mode_refuses_to_continue_when_auto_is_unavailable(self):
        cdp = MockCDP()
        cdp.eval_responses = ["opened", "unavailable"]
        with patch("scripts.framework.driver.gemini_driver.time.sleep"):
            with self.assertRaisesRegex(RuntimeError, "未提供 Auto"):
                GeminiDriver(cdp).ensure_auto_mode()

    def test_auto_mode_refuses_to_continue_before_selection_is_confirmed(self):
        cdp = MockCDP()
        cdp.eval_responses = ["opened", "choosing", "waiting"]
        with patch("scripts.framework.driver.gemini_driver.time.sleep"), \
             patch("scripts.framework.driver.gemini_driver.time.monotonic", side_effect=[0, 0, 1, 2, 15]):
            with self.assertRaisesRegex(RuntimeError, "未能确认 Gemini 已切换至 Auto"):
                GeminiDriver(cdp).ensure_auto_mode()

    def test_auto_mode_reports_google_verification(self):
        cdp = MockCDP()
        cdp.eval_responses = ["blocked"]
        with self.assertRaisesRegex(RuntimeError, "Google 人机验证拦截"):
            GeminiDriver(cdp).ensure_auto_mode()
        actions = [action for kind, action, *_ in cdp.calls if kind == "call"]
        self.assertEqual(actions, ["Emulation.setFocusEmulationEnabled"])

    def test_turn_result_defaults(self):
        tr = TurnResult(success=True, prompt="Hello Gemini")
        self.assertTrue(tr.success)
        self.assertEqual(tr.prompt, "Hello Gemini")
        self.assertEqual(tr.model_response, "")
        self.assertFalse(tr.has_images)
        self.assertEqual(tr.duration, 0.0)
        self.assertIsNone(tr.error)

    def test_gemini_chat_session_turn_accumulation(self):
        cdp = MockCDP()
        driver = GeminiDriver(cdp)
        session = GeminiChatSession(driver, chat_id="chat_123")

        # Mock execute_turn_pipeline returning success
        with patch.object(driver, "execute_turn_pipeline", return_value=(True, "OK")):
            with patch.object(driver, "get_current_chat_id", return_value="chat_123"):
                # Mock DOM evaluation for model response
                cdp.eval_responses = [
                    {"text": "Response 1", "hasImages": False, "modelCount": 1}
                ]
                res1 = session.send_turn("Prompt 1")
                self.assertTrue(res1.success)
                self.assertEqual(res1.model_response, "Response 1")
                self.assertEqual(len(session.turns), 1)

                cdp.eval_responses = [
                    {"text": "Response 2", "hasImages": True, "modelCount": 2}
                ]
                res2 = session.send_turn({"prompt": "Prompt 2 画一张图"})
                self.assertTrue(res2.success)
                self.assertTrue(res2.has_images)
                self.assertEqual(len(session.turns), 2)

    def test_prompt_words_do_not_change_waiting_or_extraction(self):
        driver = GeminiDriver(MockCDP())
        session = GeminiChatSession(driver, chat_id="content-neutral")
        for prompt in ["Explain the earlier illustration and drawing.", "Generate an image.", "Say OK."]:
            with self.subTest(prompt=prompt), \
                 patch.object(driver, "execute_turn_pipeline", return_value=(True, "OK")) as run, \
                 patch.object(driver, "get_current_chat_id", return_value=session.chat_id), \
                 patch.object(driver, "extract_turn_result", return_value=TurnResult(success=True, prompt=prompt)) as extract:
                self.assertTrue(session.send_turn(prompt, max_wait=60).success)
                run.assert_called_once_with(prompt, max_wait=60)
                self.assertEqual(set(extract.call_args.kwargs), {'duration'})

    def test_gemini_chat_session_turn_failure_fail_fast(self):
        cdp = MockCDP()
        driver = GeminiDriver(cdp)
        session = GeminiChatSession(driver, chat_id="chat_fail")

        with patch.object(driver, "execute_turn_pipeline", return_value=(False, "Detection circuit breaker tripped")):
            res = session.send_turn("Trigger fail")
            self.assertFalse(res.success)
            self.assertIn("circuit breaker", res.error)
            self.assertEqual(len(session.turns), 1)
            self.assertEqual(session.turns[0].error, res.error)

    def test_gemini_driver_new_chat_flow(self):
        cdp = MockCDP()
        driver = GeminiDriver(cdp)

        with patch("scripts.framework.actions.CDPActions.click_new_chat", return_value=True) as mock_click:
            with patch.object(driver, "ensure_auto_mode", return_value=True) as mock_model:
                # Mock state polling: ready on first check
                cdp.eval_responses = [
                    {"isAppRoute": True, "bubbleCount": 0, "hasEditor": True, "hasModeBtn": True}
                ]
                session = driver.new_chat(timeout=5.0)

                mock_click.assert_called_once_with(cdp)
                mock_model.assert_called_once_with()
                self.assertIsInstance(session, GeminiChatSession)
                self.assertIsNone(session.chat_id)
                self.assertEqual(driver.active_session, session)

    def test_chat_readiness_timeout(self):
        not_ready = {"isAppRoute": True, "bubbleCount": 2, "hasEditor": False, "hasModeBtn": False}
        for method, states in (("new_chat", [not_ready, None]), ("open_chat", [False, None])):
            for state in states:
                with self.subTest(method=method, state=state):
                    cdp = MockCDP()
                    cdp.eval_responses = [None, state]
                    driver = GeminiDriver(cdp)
                    previous_session = GeminiChatSession(driver, chat_id="previous")
                    driver.active_session = previous_session
                    with patch("scripts.framework.actions.CDPActions.click_new_chat"), \
                         patch.object(driver, "get_current_chat_id", return_value="target"), \
                         patch.object(driver, "ensure_auto_mode") as model, \
                         patch("scripts.framework.driver.gemini_driver.time.sleep"), \
                         patch("scripts.framework.driver.gemini_driver.time.time", side_effect=[0, 0, 0.5, 1]):
                        args = ("target",) if method == "open_chat" else ()
                        with self.assertRaisesRegex(RuntimeError, "readiness timed out") as error:
                            getattr(driver, method)(*args, timeout=1)
                        self.assertIn(repr(state), str(error.exception))
                        model.assert_not_called()
                        self.assertIs(driver.active_session, previous_session)

    def test_chat_readiness_zero_timeout(self):
        for method in ("new_chat", "open_chat"):
            with self.subTest(method=method):
                driver = GeminiDriver(MockCDP())
                with patch("scripts.framework.actions.CDPActions.click_new_chat"), \
                     patch.object(driver, "get_current_chat_id", return_value="target"), \
                     patch.object(driver, "ensure_auto_mode") as model:
                    args = ("target",) if method == "open_chat" else ()
                    with self.assertRaisesRegex(RuntimeError, "last state: None"):
                        getattr(driver, method)(*args, timeout=0)
                    model.assert_not_called()
                    self.assertIsNone(driver.active_session)

    def test_gemini_driver_open_chat_flow(self):
        cdp = MockCDP()
        driver = GeminiDriver(cdp)

        with patch.object(driver, "get_current_chat_id", return_value="different_chat"):
            with patch.object(driver, "ensure_auto_mode", return_value=True) as mock_model:
                cdp.eval_responses = [
                    True  # ready check on path
                ]
                session = driver.open_chat("target_chat_999", timeout=5.0)

                mock_model.assert_called_once_with()
                self.assertEqual(session.chat_id, "target_chat_999")
                self.assertEqual(driver.active_session, session)

    def test_gemini_chat_session_delete_via_web(self):
        cdp = MockCDP()
        driver = GeminiDriver(cdp)
        session = GeminiChatSession(driver, chat_id="del_chat_1")

        with patch("scripts.framework.actions.CDPActions.delete_conversation_via_web", return_value=True) as mock_del:
            ok = session.delete_via_web()
            self.assertTrue(ok)
            mock_del.assert_called_once_with(cdp, "del_chat_1")

    def test_get_current_chat_id_multi_source(self):
        from scripts.framework.actions import CDPActions
        cdp = MockCDP()

        # Case 1: URL pathname match
        cdp.eval_responses = ["abc1234567"]
        cid1 = CDPActions.get_current_chat_id(cdp)
        self.assertEqual(cid1, "abc1234567")

        # Case 2: None returned if empty
        cdp.eval_responses = [None]
        cid2 = CDPActions.get_current_chat_id(cdp)
        self.assertIsNone(cid2)


MOBILE_GEMINI = """
<button aria-label="Main menu">Menu</button>
<mat-sidenav role="navigation" aria-label="Side Navigation" class="mat-drawer">
    <gem-nav-list-item>
        <a href="/app/test-chat">Test conversation</a>
        <button aria-label="More options">Options</button>
    </gem-nav-list-item>
    <gem-nav-list-item><a href="/app/keep-chat">Keep conversation</a></gem-nav-list-item>
</mat-sidenav>
<button role="menuitem" data-test-id="delete-button" hidden>Delete</button>
<dialog role="dialog"><button>Delete</button></dialog>
<style>mat-sidenav:not(.mat-drawer-opened) { visibility: hidden; }</style>
<script>
    (() => {
        const sidebar = document.querySelector('mat-sidenav');
        const menuItem = document.querySelector('[role="menuitem"]');
        const dialog = document.querySelector('dialog');
        document.querySelector('[aria-label="Main menu"]').onclick = () =>
            sidebar.classList.toggle('mat-drawer-opened');
        document.querySelector('[aria-label="More options"]').onclick = () => {
            if (sidebar.classList.contains('mat-drawer-opened')) menuItem.hidden = false;
        };
        menuItem.onclick = () => {
            if (!menuItem.hidden) dialog.showModal();
        };
        dialog.querySelector('button').onclick = () => {
            document.querySelector('a[href="/app/test-chat"]').parentElement.remove();
            dialog.close();
        };
    })();
</script>
"""


def close_test_browser(browser, browser_ws_url):
    if browser.poll() is not None:
        return
    if browser_ws_url:
        try:
            connection = CDPConnection(browser_ws_url)
            try:
                connection.call("Browser.close", timeout=5)
            finally:
                connection.close()
        except (OSError, RuntimeError):
            pass
        try:
            browser.wait(timeout=10)
            return
        except subprocess.TimeoutExpired:
            pass
    browser.terminate()
    try:
        browser.wait(timeout=10)
    except subprocess.TimeoutExpired:
        browser.kill()
        browser.wait(timeout=10)


class TestBrowserCleanup(unittest.TestCase):
    def setUp(self):
        self.browser = Mock()
        self.browser.poll.return_value = None
        self.connection_patch = patch(__name__ + ".CDPConnection")
        self.connect = self.connection_patch.start()
        self.addCleanup(self.connection_patch.stop)

    def test_graceful_close_before_wait(self):
        lifecycle = Mock()
        lifecycle.attach_mock(self.connect, "connect")
        lifecycle.attach_mock(self.browser, "browser")
        close_test_browser(self.browser, "ws://browser")
        self.assertEqual(lifecycle.mock_calls, [
            call.browser.poll(), call.connect("ws://browser"),
            call.connect().call("Browser.close", timeout=5),
            call.connect().close(), call.browser.wait(timeout=10),
        ])

    def test_already_exited_browser(self):
        self.browser.poll.return_value = 0
        close_test_browser(self.browser, "ws://browser")
        self.connect.assert_not_called()
        self.browser.wait.assert_not_called()
        self.browser.terminate.assert_not_called()

    def test_startup_failure_without_browser_endpoint(self):
        close_test_browser(self.browser, None)
        self.connect.assert_not_called()
        self.browser.terminate.assert_called_once_with()
        self.browser.wait.assert_called_once_with(timeout=10)

    def test_disconnected_browser_still_waits_for_exit(self):
        self.connect.return_value.call.side_effect = ConnectionError("closed")
        close_test_browser(self.browser, "ws://browser")
        self.connect.return_value.close.assert_called_once_with()
        self.browser.wait.assert_called_once_with(timeout=10)
        self.browser.terminate.assert_not_called()

    def test_connection_failure_falls_back_to_termination(self):
        self.connect.side_effect = OSError("connection refused")
        self.browser.wait.side_effect = [subprocess.TimeoutExpired("chrome", 10), 0]
        close_test_browser(self.browser, "ws://browser")
        self.browser.terminate.assert_called_once_with()
        self.browser.kill.assert_not_called()
        self.assertEqual(self.browser.wait.call_count, 2)

    def test_unresponsive_browser_is_killed_and_reaped(self):
        self.browser.wait.side_effect = [
            subprocess.TimeoutExpired("chrome", 10),
            subprocess.TimeoutExpired("chrome", 10), 0,
        ]
        close_test_browser(self.browser, "ws://browser")
        self.assertEqual(self.browser.mock_calls, [
            call.poll(), call.wait(timeout=10), call.terminate(),
            call.wait(timeout=10), call.kill(), call.wait(timeout=10),
        ])


class TestGeminiSidebarDelete(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        browsers = sorted((Path.home() / ".cache/ms-playwright").glob("chromium-*/chrome-linux*/chrome"))
        if not browsers:
            raise unittest.SkipTest("Playwright Chromium is not installed")
        profile = tempfile.TemporaryDirectory()
        cls.addClassCleanup(profile.cleanup)
        browser = subprocess.Popen([
            str(browsers[-1]), "--headless=new", "--no-sandbox", "--disable-gpu",
            "--remote-debugging-port=0", f"--user-data-dir={profile.name}", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        browser_ws_url = None

        def close_browser():
            close_test_browser(browser, browser_ws_url)

        cls.addClassCleanup(close_browser)
        port_file = Path(profile.name) / "DevToolsActivePort"
        deadline = time.monotonic() + 10
        while not port_file.exists() and browser.poll() is None and time.monotonic() < deadline:
            time.sleep(0.05)
        if not port_file.exists():
            raise RuntimeError("Chromium CDP did not become ready")
        port, browser_path = port_file.read_text().splitlines()[:2]
        port = int(port)
        browser_ws_url = f"ws://127.0.0.1:{port}{browser_path}"
        tab = next(tab for tab in get_tabs(port) if tab["type"] == "page")
        cls.cdp = CDPConnection(tab["webSocketDebuggerUrl"])
        cls.addClassCleanup(cls.cdp.close)

    def test_delete_with_mobile_sidebar_open_or_closed(self):
        sidebar_is_open = "!!document.querySelector('mat-sidenav.mat-drawer-opened')"
        for initially_open in (True, False):
            with self.subTest(initially_open=initially_open):
                frame = self.cdp.call("Page.getFrameTree")["result"]["frameTree"]["frame"]
                self.cdp.call("Page.setDocumentContent", {"frameId": frame["id"], "html": MOBILE_GEMINI})
                if initially_open:
                    self.cdp.eval('document.querySelector(\'[aria-label="Main menu"]\').click()')
                self.assertEqual(self.cdp.eval(sidebar_is_open), initially_open)
                session = GeminiChatSession(GeminiDriver(self.cdp), chat_id="test-chat")
                deleted = session.delete_via_web()
                self.assertTrue(self.cdp.eval(sidebar_is_open), "Delete should leave the sidebar open")
                self.assertTrue(deleted)
                self.assertFalse(self.cdp.eval('!!document.querySelector(\'a[href="/app/test-chat"]\')'))
                self.assertTrue(self.cdp.eval('!!document.querySelector(\'a[href="/app/keep-chat"]\')'))


if __name__ == "__main__":
    unittest.main()
