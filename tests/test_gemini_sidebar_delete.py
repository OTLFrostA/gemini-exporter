import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from scripts.cdp_client import CDPConnection, get_tabs
from scripts.framework.driver.gemini_driver import GeminiChatSession, GeminiPlatformDriver


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

        def close_browser():
            browser.terminate()
            browser.wait(timeout=10)

        cls.addClassCleanup(close_browser)
        port_file = Path(profile.name) / "DevToolsActivePort"
        deadline = time.monotonic() + 10
        while not port_file.exists() and browser.poll() is None and time.monotonic() < deadline:
            time.sleep(0.05)
        if not port_file.exists():
            raise RuntimeError("Chromium CDP did not become ready")
        port = int(port_file.read_text().splitlines()[0])
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
                session = GeminiChatSession(GeminiPlatformDriver(self.cdp), chat_id="test-chat")
                deleted = session.delete_via_web()
                self.assertTrue(self.cdp.eval(sidebar_is_open), "Delete should leave the sidebar open")
                self.assertTrue(deleted)
                self.assertFalse(self.cdp.eval('!!document.querySelector(\'a[href="/app/test-chat"]\')'))
                self.assertTrue(self.cdp.eval('!!document.querySelector(\'a[href="/app/keep-chat"]\')'))
