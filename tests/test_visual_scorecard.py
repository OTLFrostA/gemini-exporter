import os
import sys
import tempfile
import unittest
from html import escape
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from scripts.visual_agent.scorecard import VisualUXScorecard, SelfHealingEvent, VisualRisk


class ReportParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.elements = []
        self.text = []

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))

    def handle_data(self, data):
        self.text.append(data)


class TestVisualScorecard(unittest.TestCase):
    def test_save_escapes_untrusted_html(self):
        with tempfile.TemporaryDirectory() as output_dir:
            card = VisualUXScorecard(output_dir)
            payload = '</pre><script>TAG</script><b id="injected">PWNED</b>&\'"'
            path = os.path.join(output_dir, 'shot" onerror="alert(1)" data-injected="yes.png')
            card.record_feature(payload, payload, "PASS", 1.2, payload)
            card.record_risk(VisualRisk(payload, payload, payload, payload, payload))
            card.record_self_healing(SelfHealingEvent(payload, payload, 1, payload, payload, 1.0, True))
            card.ai_review = payload
            card.record_screenshot(payload, path, payload)
            card.screenshots[0]["time"] = payload
            card.save()

            report = Path(output_dir, "visual_audit_report.html").read_text(encoding="utf-8")
            parser = ReportParser()
            parser.feed(report)
            self.assertFalse(any(tag in ("script", "b") for tag, _ in parser.elements))
            self.assertFalse(any(key.startswith("on") or key == "data-injected"
                                 for _, attrs in parser.elements for key in attrs))
            self.assertIn(payload, "".join(parser.text))
            self.assertIn(escape(payload, quote=True), report)
            images = [attrs for tag, attrs in parser.elements if tag == "img"]
            self.assertEqual(images, [{"src": os.path.relpath(path, output_dir),
                                       "alt": payload, "loading": "lazy"}])
            self.assertIn(payload, Path(output_dir, "visual_audit_scorecard.md").read_text(encoding="utf-8"))

    def test_save_empty_report(self):
        with tempfile.TemporaryDirectory() as output_dir:
            VisualUXScorecard(output_dir).save()
            parser = ReportParser()
            parser.feed(Path(output_dir, "visual_audit_report.html").read_text(encoding="utf-8"))
            self.assertFalse(any(tag == "img" for tag, _ in parser.elements))


if __name__ == "__main__":
    unittest.main()
