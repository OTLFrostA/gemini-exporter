# tests/test_selectors_and_gateway.py
"""
Unit tests for GeminiSelectors, WorkbenchSelectors, and SafeInteractionGateway.
Validates central selector registry consistency, URL allowlist filtering,
rate limit protection, and audit logging.
"""

import os
import sys
import unittest
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from scripts.framework.actions import CDPActions
from scripts.framework.gateway import SafeInteractionGateway, SecurityViolationError, get_gateway
from scripts.framework.selectors import GeminiSelectors, WorkbenchSelectors


class TestSelectorsSuite(unittest.TestCase):
    """验证 DOM 选择器中央注册表的完整性与构建逻辑"""

    def test_nav_item_builder(self):
        selector = GeminiSelectors.nav_item_by_chat_id(" abc12345 ")
        self.assertEqual(
            selector,
            'gem-nav-list-item a[href*="abc12345"], nav a[href*="abc12345"], a[href*="abc12345"]',
            "navigation must target the requested chat ID without whitespace",
        )

    def test_workbench_item_builder(self):
        expected = '#list .item[data-chat-id="abc12345"], #list .item[data-chat-id="c_abc12345"]'
        for chat_id in ["abc12345", "c_abc12345"]:
            self.assertEqual(WorkbenchSelectors.item_by_chat_id(chat_id), expected,
                "both provider ID forms must target exactly the same two workbench rows")


class TestSafeInteractionGatewaySuite(unittest.TestCase):
    """验证安全交互网关的域名白名单、速率限制与审计机制"""

    def setUp(self):
        self.gateway = SafeInteractionGateway(
            allowed_hosts=["gemini.google.com", "accounts.google.com"],
            min_action_interval=0.01,
            enable_strict_domain_check=True
        )

    def test_url_validation_allowed(self):
        self.assertTrue(self.gateway.validate_url("https://gemini.google.com/app"))
        self.assertTrue(self.gateway.validate_url("https://gemini.google.com/app/1bd028d5c5b0c0e2"))
        self.assertTrue(self.gateway.validate_url("https://accounts.google.com/signin"))
        self.assertTrue(self.gateway.validate_url("chrome-extension://abcdefg/options.html"))
        self.assertTrue(self.gateway.validate_url("chrome://extensions"))

    def test_url_validation_blocked(self):
        self.assertFalse(self.gateway.validate_url("https://malicious-site.com"))
        for url in [
            "https://evil-gemini.google.com.attacker.com",
            "https://gemini.google.com.attacker.com/app",
            "https://gemini.google.com@attacker.com/app",
            "http://gemini.google.com/app",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "",
        ]:
            self.assertFalse(self.gateway.validate_url(url), f"forbidden navigation accepted: {url}")

    def test_safe_navigate_success(self):
        mock_cdp = MagicMock()
        mock_cdp.call.return_value = {"result": {"frameId": "frame-1"}}

        res = self.gateway.safe_navigate(mock_cdp, "https://gemini.google.com/app")
        self.assertTrue(res)
        mock_cdp.call.assert_called_once_with("Page.navigate", {"url": "https://gemini.google.com/app"})

        summary = self.gateway.get_summary()
        self.assertEqual(summary["total"], 1)
        self.assertEqual(summary["success"], 1)
        self.assertEqual(summary["blocked"], 0)

    def test_safe_navigate_uses_logged_fallback_after_cdp_navigation_error(self):
        mock_cdp = MagicMock()
        url = r'''https://gemini.google.com/app/notes?title="O'Brien\draft"'''
        mock_cdp.call.side_effect = [
            RuntimeError("Page.navigate failed"),
            {"result": {"result": {"type": "string", "value": url}}},
        ]
        self.assertTrue(self.gateway.safe_navigate(mock_cdp, url))
        self.assertEqual(mock_cdp.call.call_count, 2)
        self.assertEqual(mock_cdp.call.call_args_list[0].args, ("Page.navigate", {"url": url}))
        method, params = mock_cdp.call.call_args.args
        self.assertEqual(method, "Runtime.evaluate")
        expression = params["expression"]
        prefix = "window.location.href = "
        self.assertTrue(expression.startswith(prefix))
        self.assertEqual(json.loads(expression[len(prefix):]), url)
        self.assertEqual(self.gateway.audit_log[-1]["action"], "NAVIGATE_FALLBACK")
        self.assertEqual(self.gateway.audit_log[-1]["status"], "SUCCESS")

    def test_new_chat_retries_after_cdp_navigation_error_reply(self):
        url = "https://gemini.google.com/app"
        for navigate_reply in (
            {"error": {"code": -32000, "message": "Navigation rejected"}},
            {"result": {"frameId": "frame-1", "errorText": "net::ERR_ABORTED"}},
        ):
            with self.subTest(navigate_reply=navigate_reply):
                gateway = SafeInteractionGateway()
                cdp = MagicMock()
                cdp.call.side_effect = [
                    navigate_reply,
                    {"result": {"result": {"type": "string", "value": url}}},
                ]
                with patch("scripts.framework.actions.get_gateway", return_value=gateway), \
                     patch("scripts.framework.actions.time.sleep"):
                    self.assertTrue(CDPActions.click_new_chat(cdp))
                self.assertEqual(
                    [(entry["action"], entry["status"]) for entry in gateway.audit_log],
                    [("NAVIGATE_FALLBACK", "SUCCESS")],
                )
                self.assertEqual(
                    [call.args[0] for call in cdp.call.call_args_list],
                    ["Page.navigate", "Runtime.evaluate"],
                )

    def test_safe_navigate_audits_failed_cdp_fallback(self):
        url = "https://gemini.google.com/app"
        for fallback_reply, message in (
            ({"error": {"code": -32000, "message": "Execution context unavailable"}}, "Execution context unavailable"),
            ({"result": {"result": {"type": "object"}, "exceptionDetails": {"text": "Uncaught"}}}, "Uncaught"),
        ):
            with self.subTest(fallback_reply=fallback_reply):
                gateway = SafeInteractionGateway()
                cdp = MagicMock()
                cdp.call.side_effect = [
                    {"result": {"frameId": "frame-1", "errorText": "net::ERR_ABORTED"}},
                    fallback_reply,
                ]
                self.assertFalse(gateway.safe_navigate(cdp, url))
                self.assertEqual(len(gateway.audit_log), 1)
                entry = gateway.audit_log[0]
                self.assertEqual((entry["action"], entry["status"]), ("NAVIGATE", "FAILED"))
                self.assertIn("net::ERR_ABORTED", entry["error"])
                self.assertIn(message, entry["error"])

    def test_safe_navigate_blocked_raises_security_error(self):
        mock_cdp = MagicMock()

        with self.assertRaises(SecurityViolationError):
            self.gateway.safe_navigate(mock_cdp, "https://unauthorized-domain.com")

        mock_cdp.call.assert_not_called()
        mock_cdp.eval.assert_not_called()
        summary = self.gateway.get_summary()
        self.assertEqual(summary["total"], 1)
        self.assertEqual(summary["blocked"], 1)

    def test_audit_logging_and_dump(self):
        self.gateway.record_audit("TEST_ACTION", "target_item", "SUCCESS", duration=0.05, details={"foo": "bar"})
        entry = self.gateway.audit_log[0]
        self.assertEqual(entry["duration_ms"], 50)
        with TemporaryDirectory() as directory:
            target = Path(directory) / "audit" / "events.json"
            self.gateway.dump_audit_log(str(target))
            self.assertTrue(target.is_file(), "audit must be written to disk, not just buffered")
            report = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(report["total_actions"], 1)
            self.assertEqual(report["entries"], [entry])
            self.assertEqual(report["entries"][0]["details"], {"foo": "bar"})
            self.assertEqual(self.gateway.get_summary(),
                {"total": 1, "success": 1, "blocked": 0, "failed": 0})

    def test_global_gateway_singleton(self):
        g1 = get_gateway()
        g2 = get_gateway()
        self.assertIs(g1, g2)

    def test_safe_send_turn_success_and_audit(self):
        mock_cdp = MagicMock()
        mock_cdp.eval.return_value = {"hasCaptcha": False, "hasAbuse": False}
        send_fn = MagicMock(return_value=(True, "ok"))

        res = self.gateway.safe_send_turn(mock_cdp, send_fn, "Hello Gemini", custom_cooldown=0.0)
        self.assertEqual(res, (True, "ok"))
        send_fn.assert_called_once_with(mock_cdp, "Hello Gemini")
        self.assertTrue(any(e["action"] == "SEND_TURN" and e["status"] == "SUCCESS" for e in self.gateway.audit_log))

    def test_safe_send_turn_enforces_maximum_before_sending_another_message(self):
        gateway = SafeInteractionGateway(max_turns_per_run=1, min_turn_interval=0)
        mock_cdp = MagicMock()
        mock_cdp.eval.return_value = {"hasCaptcha": False, "hasAbuse": False}
        send_fn = MagicMock(return_value=(True, "ok"))
        self.assertEqual(gateway.safe_send_turn(mock_cdp, send_fn, "First", custom_cooldown=0), (True, "ok"))
        from scripts.framework.gateway import CircuitBreakerError
        with self.assertRaises(CircuitBreakerError):
            gateway.safe_send_turn(mock_cdp, send_fn, "Second", custom_cooldown=0)
        send_fn.assert_called_once_with(mock_cdp, "First")
        self.assertEqual(gateway.get_summary(),
            {"total": 2, "success": 1, "blocked": 1, "failed": 0})

    def test_safe_send_turn_circuit_breaker_on_captcha(self):
        mock_cdp = MagicMock()
        mock_cdp.eval.return_value = {"hasCaptcha": True, "hasAbuse": False}
        send_fn = MagicMock()

        from scripts.framework.gateway import CircuitBreakerError
        with self.assertRaises(CircuitBreakerError):
            self.gateway.safe_send_turn(mock_cdp, send_fn, "Trigger CAPTCHA", custom_cooldown=0.0)
        send_fn.assert_not_called()

    def test_safe_send_turn_circuit_breaker_on_quota_error(self):
        mock_cdp = MagicMock()
        mock_cdp.eval.return_value = {"hasCaptcha": False, "hasAbuse": False}
        send_fn = MagicMock(return_value=(False, "HTTP 429 Too Many Requests: quota exceeded"))

        from scripts.framework.gateway import CircuitBreakerError
        with self.assertRaises(CircuitBreakerError):
            self.gateway.safe_send_turn(mock_cdp, send_fn, "Spam turn", custom_cooldown=0.0)
        send_fn.assert_called_once()
        self.assertEqual(self.gateway.get_summary()["blocked"], 1)
        self.assertFalse(any(e["action"] == "SEND_TURN" and e["status"] == "SUCCESS"
                             for e in self.gateway.audit_log))

    def test_safe_delete_success_and_audit(self):
        mock_cdp = MagicMock()
        delete_fn = MagicMock(return_value=True)

        res = self.gateway.safe_delete(mock_cdp, delete_fn, "c_123456", custom_cooldown=0.0)
        self.assertTrue(res)
        delete_fn.assert_called_once_with(mock_cdp, "c_123456")
        self.assertTrue(any(e["action"] == "DELETE_CHAT" and e["target"] == "c_123456" for e in self.gateway.audit_log))
        self.assertEqual(self.gateway.get_summary()["success"], 1)

    def test_safe_delete_records_failure_without_claiming_success(self):
        mock_cdp = MagicMock()
        delete_fn = MagicMock(return_value=False)
        self.assertFalse(self.gateway.safe_delete(mock_cdp, delete_fn, "c_missing", custom_cooldown=0))
        delete_fn.assert_called_once_with(mock_cdp, "c_missing")
        self.assertEqual(self.gateway.get_summary()["failed"], 1)
        self.assertEqual(self.gateway.audit_log[-1]["status"], "FAILED")


if __name__ == "__main__":
    unittest.main()
