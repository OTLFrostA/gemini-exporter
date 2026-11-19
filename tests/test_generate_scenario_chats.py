"""Exercise the generator's CLI with only browser interactions mocked."""
import contextlib
import io
import json
from pathlib import Path
import runpy
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


def run_cli(dataset, outcomes, ready=True):
    with patch('scripts.cdp_client.get_tabs', return_value=[{
        'type': 'page', 'url': 'https://gemini.google.com/app',
        'webSocketDebuggerUrl': 'ws://mock',
    }]), patch('scripts.cdp_client.CDPConnection') as connection, patch(
        'scripts.framework.driver.gemini_driver.GeminiPlatformDriver'
    ) as driver, patch.object(sys, 'argv', [
        'generate_scenario_chats.py', '--dataset', str(dataset), '--delay', '0',
    ]):
        driver.return_value.ensure_ready.return_value = ready
        driver.return_value.execute_turn_pipeline.side_effect = outcomes
        driver.return_value.get_current_chat_id.return_value = 'mock-chat'
        try:
            runpy.run_path(str(ROOT / 'scripts/generate_scenario_chats.py'), run_name='__main__')
        finally:
            connection.return_value.close.assert_called_once_with()


class TestGenerateScenarioChats(unittest.TestCase):
    def invoke(self, outcomes, ready=True, scenarios=None):
        if scenarios is None:
            scenarios = [{'id': 'regression', 'title': 'Regression', 'turns': ['prompt'] * 5}]
        with tempfile.TemporaryDirectory() as directory:
            dataset = Path(directory) / 'scenarios.json'
            dataset.write_text(json.dumps(scenarios), encoding='utf-8')
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                try:
                    run_cli(dataset, outcomes, ready)
                except SystemExit as exc:
                    code = exc.code
                else:
                    code = 0
            return code, output.getvalue()

    def test_all_turns_fail(self):
        code, output = self.invoke([(False, 'mock turn failed')] * 5)
        self.assertIn('部分成功 | 会话 ID: 未知 | 轮数: 0/5', output)
        self.assertNotEqual(code, 0)

    def test_one_turn_fails(self):
        code, output = self.invoke([(True, '')] * 4 + [(False, 'mock turn failed')])
        self.assertIn('轮数: 4/5', output)
        self.assertNotEqual(code, 0)

    def test_page_not_ready(self):
        code, output = self.invoke([], ready=False)
        self.assertIn('页面加载就绪超时', output)
        self.assertNotEqual(code, 0)

    def test_full_success(self):
        code, output = self.invoke([(True, '')] * 5)
        self.assertIn('成功 | 会话 ID: mock-chat | 轮数: 5/5', output)
        self.assertEqual(code, 0)

    def test_empty_dataset(self):
        code, _ = self.invoke([], scenarios=[])
        self.assertEqual(code, 0)


if __name__ == '__main__':
    unittest.main()
