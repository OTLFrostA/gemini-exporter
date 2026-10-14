"""Counterexamples for the existing Tier 2 cases; no Google/network required."""
import base64
import copy
import hashlib
import io
import json
import os
import subprocess
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.framework.assertions import (
    CDPAssertions, assert_archive_targets, assert_scan_result, assert_turn_content, assert_incremental_scan_result, assert_full_scan_coverage, assert_passive_coverage, assert_activity_sync_result, assert_followup_scan_result,
)
from scripts.framework.actions import CDPActions
from scripts.framework.cases.base import TestContext, DAGRunner, FeatureTestCase
from scripts.framework.cases.chat import ImagenMultimodalCase
from scripts.framework.cases.export import (
    LiveSaveNewChatCase, HtmlExportDownloadCase, PdfExportDownloadCase,
    FastSkipExportedCase, select_format_targets,
)
from scripts.framework.cases.takeout import validate_takeout_records, TakeoutZipImportCase
from scripts.framework.cases.sync import wait_for_prior_scan
from scripts.framework.driver.platform_driver import TurnResult
from scripts.framework.driver.gemini_driver import GeminiPlatformDriver
from scripts.framework.features import FeatureDomain, FeatureRegistry, TestStatus
from scripts.framework.scenario_provider import OnlineScenarioProvider

CID = '0123456789abcdef'
OTHER = 'abcdef0123456789'
REPLY = 'The measured pressure is bounded by the conservation law and the calibrated sensor readings.'
EVIDENCE = [{'prompt': 'Explain **pressure** and mass_balance.', 'response': REPLY, 'has_images': False}]


def document(evidence=EVIDENCE, cid=CID):
    body = f'---\nid: "{cid}"\n---\n# Conversation\n'
    for t in evidence:
        body += f"\n## 👤 You\n\n{t['prompt']}\n\n## 🤖 Assistant\n\n{t['response']}\n"
    return body


def scan_evidence():
    return {'started': True, 'finished': True, 'response': {'success': True, 'diagnostics': {
        'incremental': False, 'totalPagesFetched': 2, 'totalConversations': 40,
        'endTime': '2026-10-09T20:00:00Z', 'hitGoogleLimit': False,
        'stopReason': '第 2 页未返回下页游标 nextPageToken，Google 服务端游标已到底',
        'pageHistory': [{'page': 1, 'hasNextPageToken': True}, {'page': 2, 'hasNextPageToken': False}],
    }}}


class SettledEvidenceTests(unittest.TestCase):
    def test_append_freeze_preserves_stream_history_and_records_all_final_turns(self):
        with tempfile.TemporaryDirectory() as directory:
            ctx = TestContext(output_dir=directory)
            record = {'chat_id': CID}
            ctx.record_turn(record, TurnResult(True, 'First prompt', 'Stream capture', chat_id=CID))
            driver = MagicMock()
            first = {'prompt': 'First prompt', 'response': 'Final first answer', 'has_images': False, 'code_blocks': [], 'execution_blocks': []}
            last = {'prompt': 'Append prompt', 'response': 'Final appended answer', 'has_images': False, 'code_blocks': [], 'execution_blocks': []}
            driver.settled_conversation_evidence.side_effect = [[first], [first, last]]
            ctx.freeze_turn_evidence(driver, record)
            ctx.record_turn(record, TurnResult(True, 'Append prompt', 'Transient append', chat_id=CID))
            ctx.freeze_turn_evidence(driver, record)
            self.assertEqual(record['turn_evidence'], [first, last])
            self.assertEqual([t['response'] for t in record['stream_turn_evidence']], ['Stream capture', 'Transient append'])
            driver.settled_conversation_evidence.assert_called_with(CID, ['First prompt', 'Append prompt'])
            saved = json.loads((Path(directory)/f'{CID}_turn_evidence.json').read_text())
            self.assertEqual(saved, record)

    def state(self):
        return {'chat_id': CID, 'streaming': False, 'turns': [
            {'prompt': 'Explain pressure.', 'response': REPLY, 'has_images': False, 'code_blocks': ['if ready:\n    run()']}]}

    def test_late_rendering_must_settle_without_navigation_or_export_feedback(self):
        final = self.state()
        streaming = copy.deepcopy(final); streaming['streaming'] = True
        transient = copy.deepcopy(final); transient['turns'][0]['response'] = 'Unfinished rendering'
        cdp = MagicMock(); cdp.eval.side_effect = [streaming, transient, final, final, final]
        with patch('scripts.framework.driver.gemini_driver.time.sleep'):
            result = GeminiPlatformDriver(cdp).settled_conversation_evidence(CID, ['Explain pressure.'])
        self.assertEqual(result, final['turns'])
        self.assertEqual(cdp.eval.call_count, 5)
        cdp.call.assert_not_called()

    def test_other_conversation_evidence_is_rejected(self):
        cdp = MagicMock(); state = self.state(); state['chat_id'] = OTHER; cdp.eval.return_value = state
        with self.assertRaises(RuntimeError):
            GeminiPlatformDriver(cdp).settled_conversation_evidence(CID, ['Explain pressure.'])

    def test_missing_turns_changed_prompts_and_empty_answers_cannot_settle(self):
        for change in ('missing', 'prompt', 'empty'):
            with self.subTest(change=change):
                state = self.state()
                if change == 'missing': state['turns'] = []
                elif change == 'prompt': state['turns'][0]['prompt'] = 'A different sent prompt'
                else: state['turns'][0]['response'] = ''
                cdp = MagicMock(); cdp.eval.return_value = state
                with patch('scripts.framework.driver.gemini_driver.time.sleep'), \
                     patch('scripts.framework.driver.gemini_driver.time.monotonic', side_effect=[0, 0, 2]):
                    with self.assertRaises(RuntimeError):
                        GeminiPlatformDriver(cdp).settled_conversation_evidence(CID, ['Explain pressure.'], timeout=1)


class DiskContentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.md = self.root / f'Chat_{CID[-6:]}.md'
        self.md.write_text(document())

    def tearDown(self):
        self.temp.cleanup()

    def check(self, evidence=EVIDENCE, baseline=None):
        return CDPAssertions.assert_real_disk_live_save(
            str(self.root), [CID], turn_evidence={CID: evidence},
            baselines={CID: baseline} if baseline is not None else None)[0]

    def test_actual_complete_reply_passes_and_missing_last_turn_fails(self):
        newer = EVIDENCE + [{'prompt': 'Give one capacity planning recommendation.',
                             'response': 'Reserve enough headroom for peak traffic and verify it with representative load measurements.',
                             'has_images': False}]
        before = document()
        self.assertFalse(self.check(newer, before))  # old, nonempty file
        self.md.write_text(document(newer))
        self.assertTrue(self.check(newer, before))
        self.assertFalse(self.check(newer, document(newer)))

    def test_original_turns_must_survive_append(self):
        newer = EVIDENCE + [{'prompt': 'Append a summary.', 'response': REPLY + ' Final recommendation.', 'has_images': False}]
        self.md.write_text(document(newer))
        self.assertFalse(self.check(newer, document().replace(REPLY, 'Original content that has been lost.')))

    def test_prompt_or_old_response_cannot_impersonate_last_model_answer(self):
        bad = document().replace(REPLY, 'No actual answer was persisted.')
        self.md.write_text(bad.replace(EVIDENCE[0]['prompt'], EVIDENCE[0]['prompt'] + REPLY))
        self.assertFalse(self.check())
        self.md.write_text(document().replace('## 🤖 Assistant', '## 👤 You'))
        self.assertFalse(self.check())

    def test_full_identity_and_uniqueness_are_required(self):
        self.md.write_text(document(cid='different' + CID[-6:]))
        self.assertFalse(self.check())
        self.md.write_text(document())
        (self.root / f'Other_{CID[-6:]}.md').write_text(document())
        self.assertFalse(self.check())

    def test_markdown_spaces_and_escaping_are_normalized(self):
        self.md.write_text(document().replace('mass_balance', 'mass\\_balance').replace(REPLY, '**' + REPLY.replace(' ', '\n') + '**'))
        self.assertTrue(self.check())

    def test_empty_nontext_reply_does_not_pass_without_image_entity(self):
        image = [{'prompt': 'Draw a diagram.', 'response': '', 'has_images': True}]
        self.md.write_text(document(image))
        self.assertFalse(self.check(image))
        self.md.write_text(document(image).replace('## 🤖 Assistant\n\n', '## 🤖 Assistant\n\n![Image](assets/diagram.png)'))
        self.assertFalse(self.check(image))
        (self.root / 'assets').mkdir()
        (self.root / 'assets/diagram.png').write_bytes(b'nonempty image bytes')
        self.assertTrue(self.check(image))
        self.md.write_text(self.md.read_text() + '\nFabricated extra answer text.\n')
        self.assertFalse(self.check(image))
        self.md.write_text(document(image).replace('## 🤖 Assistant\n\n', '## 🤖 Assistant\n\n![Image](assets/diagram.png)'))
        image[0]['has_images'] = False
        self.assertFalse(self.check(image))

    def test_flush_failure_cannot_pass_using_old_file(self):
        ctx = MagicMock(output_dir=str(self.root))
        ctx.chat_records = [{'chat_id': OTHER}, {'chat_id': CID, 'turn_evidence': EVIDENCE}]
        with patch.object(CDPActions, 'flush_live_save_to_disk', return_value={'ok': False, 'error': 'read failed'}):
            self.assertFalse(LiveSaveNewChatCase().execute(ctx)[0])

    def test_opfs_mtime_is_preserved_in_physical_copy(self):
        cdp = MagicMock()
        cdp.eval.return_value = {'ok': True, 'files': [{'path': 'old.md', 'text': 'old content', 'mtime': 100000}]}
        self.assertTrue(CDPActions.flush_live_save_to_disk(cdp, str(self.root))['ok'])
        self.assertEqual((self.root / 'gemini_export/old.md').stat().st_mtime, 100)



    def test_zip_download_is_routed_on_the_live_export_connection(self):
        cdp = MagicMock()
        cdp.call.return_value = {'id': 1, 'result': {}}
        path = self.root / 'gemini_export_fresh.zip'
        def export_now(*args, **kwargs):
            path.write_bytes(b'fresh ZIP bytes')
        cdp.eval.side_effect = export_now
        with patch('scripts.framework.actions.time.sleep'):
            result = CDPActions.trigger_export_zip(cdp, str(self.root), max_wait=1)
        self.assertEqual(result, str(path))
        cdp.call.assert_called_once_with('Browser.setDownloadBehavior', {
            'behavior': 'allow', 'downloadPath': str(self.root), 'eventsEnabled': True})

    def test_download_routing_failure_cannot_click_or_reuse_old_zip(self):
        (self.root / 'gemini_export_old.zip').write_bytes(b'old ZIP bytes')
        cdp = MagicMock()
        cdp.call.return_value = {'error': {'message': 'denied'}}
        self.assertIsNone(CDPActions.trigger_export_zip(cdp, str(self.root), max_wait=1))
        cdp.eval.assert_not_called()

    def test_cdp_download_directory_configuration_failure(self):
        # 1. 模拟 CDP 返回错误响应
        cdp_err = MagicMock()
        cdp_err.call.return_value = {'error': {'code': -32000, 'message': 'Browser.setDownloadBehavior denied'}}
        self.assertIsNone(CDPActions.trigger_export_zip(cdp_err, str(self.root), max_wait=1))
        cdp_err.eval.assert_not_called()

        # 2. 模拟 CDP 调用抛出连接或协议异常
        cdp_exc = MagicMock()
        cdp_exc.call.side_effect = RuntimeError("WebSocket connection dropped")
        self.assertIsNone(CDPActions.trigger_export_zip(cdp_exc, str(self.root), max_wait=1))
        cdp_exc.eval.assert_not_called()

        # 3. 严格禁止通过系统默认 ~/Downloads 目录搜索或回退旧文件
        with patch('glob.glob', return_value=['/Users/user/Downloads/gemini_export_leaked.zip']):
            self.assertIsNone(CDPActions.trigger_export_zip(cdp_err, str(self.root), max_wait=1))

    def test_role_headings_inside_code_are_not_turns(self):
        evidence = [{'prompt': EVIDENCE[0]['prompt'], 'response': '## 👤 You\n' + REPLY}]
        text = document().replace(REPLY, '```markdown\n## 👤 You\n```\n' + REPLY)
        self.assertTrue(assert_turn_content(text, evidence)[0])

    def test_hidden_thinking_content_is_excluded_from_authored_body(self):
        authored_response = '系统在受扰动后将沿极限环收敛，其李雅普诺夫指数满足严格负定。'
        hidden_thinking = '思考过程：首先推导雅可比矩阵特征值，然后验证迹与行列式符号。'
        evidence_with_thinking = [{'prompt': '分析系统稳定性。', 'response': hidden_thinking + authored_response}]
        evidence_clean = [{'prompt': '分析系统稳定性。', 'response': authored_response}]
        exported = f"""## 👤 You
分析系统稳定性。
## 🤖 Assistant
{authored_response}
"""
        ok, msg = assert_turn_content(exported, evidence_with_thinking)
        self.assertFalse(ok)
        self.assertIn("全文不匹配", msg)
        self.assertTrue(assert_turn_content(exported, evidence_clean)[0])

    def test_inline_and_block_latex_semantic_comparison(self):
        inline_formula = r"E = mc^2"
        block_formula = r"\int_{-\infty}^{+\infty} e^{-x^2} dx = \sqrt{\pi}"
        evidence = [{'prompt': '给出核心物理与数学公式。',
                     'response': f"行内能量公式{inline_formula}。高斯积分块级公式如下：{block_formula}证明完毕。"}]
        exported = f"""## 👤 You
给出核心物理与数学公式。
## 🤖 Assistant
行内能量公式 ${inline_formula}$。高斯积分块级公式如下：

$$
{block_formula}
$$

证明完毕。
"""
        self.assertTrue(assert_turn_content(exported, evidence)[0])
        self.assertFalse(assert_turn_content(exported.replace("mc^2", "mc^3"), evidence)[0])
        self.assertFalse(assert_turn_content(exported.replace(r"\sqrt{\pi}", r"\pi"), evidence)[0])
        self.assertFalse(assert_turn_content(exported.replace(f"$$\n{block_formula}\n$$", ""), evidence)[0])

    def test_code_block_exact_preservation_and_comparison(self):
        code = "def solve_matrix(a, b):\n    # First step\n    if a is None:\n        return b\n\n    return a @ b"
        evidence = [{'prompt': '给出矩阵求解函数。',
                     'response': f"代码实现如下：{code}调用结束。",
                     'code_blocks': [code]}]
        exported = f"""## 👤 You
给出矩阵求解函数。
## 🤖 Assistant
代码实现如下：
```python
{code}
```
调用结束。
"""
        self.assertTrue(assert_turn_content(exported, evidence)[0])
        self.assertFalse(assert_turn_content(exported.replace("        return b", "    return b"), evidence)[0])
        self.assertFalse(assert_turn_content(exported.replace("\n\n    return a @ b", "\n    return a @ b"), evidence)[0])

    def test_short_actual_answer_requires_its_whole_body(self):
        evidence = [{'prompt': '给一句建议', 'response': '以真实负载验证容量上限。', 'has_images': False}]
        self.assertTrue(assert_turn_content(document(evidence), evidence)[0])
        self.assertFalse(assert_turn_content(document(evidence).replace('以真实负载验证容量上限。', '验证容量。'), evidence)[0])

    def test_long_answer_middle_omission_fails(self):
        head = "首段引言与背景：阐述物理场耦合与偏微分方程初边值条件。" * 15
        middle = "核心中间推导步骤：构造格林函数并完成边界积分奇异性消除计算。" * 20
        tail = "尾部终局结论与数值验证：相对误差小于万分之一，理论与仿真一致。" * 15
        full_response = head + middle + tail
        evidence = [{'prompt': '给出完整长篇场论推导。', 'response': full_response}]
        exported_full = f"## 👤 You\n给出完整长篇场论推导。\n## 🤖 Assistant\n{full_response}\n"
        self.assertTrue(assert_turn_content(exported_full, evidence)[0])
        # 中段核心推导缺失（即使头尾片段存在），必须严格报错失败
        exported_omitted = exported_full.replace(middle, "")
        ok, msg = assert_turn_content(exported_omitted, evidence)
        self.assertFalse(ok)
        self.assertIn("全文不匹配", msg)

    def test_long_answer_tail_truncation_fails(self):
        head = "引言与参数设置概述。" * 20
        middle = "流体动力学纳维-斯托克斯方程渐近展开与二阶摄动求解。" * 20
        tail = "终态收敛性与边界层厚度渐近解结论。" * 10
        full_response = head + middle + tail
        evidence = [{'prompt': '推导渐近展开。', 'response': full_response}]
        exported_full = f"## 👤 You\n推导渐近展开。\n## 🤖 Assistant\n{full_response}\n"
        self.assertTrue(assert_turn_content(exported_full, evidence)[0])
        # 尾部截断必须严格报错失败
        exported_truncated = exported_full.replace(tail, "")
        ok, msg = assert_turn_content(exported_truncated, evidence)
        self.assertFalse(ok)
        self.assertIn("全文不匹配", msg)

    def test_long_answer_requires_middle_and_tail_not_just_two_fragments(self):
        response = 'Opening explanation. ' * 20 + 'Essential middle calculation. ' * 10 + 'Required final conclusion.'
        evidence = [{'prompt': 'Explain the whole calculation.', 'response': response}]
        self.assertTrue(assert_turn_content(document(evidence), evidence)[0])
        for shortened in ('Opening explanation. ' * 20,
                          response.replace('Essential middle calculation. ' * 10, ''),
                          response.removesuffix('Required final conclusion.')):
            with self.subTest(shortened=shortened[-40:]):
                self.assertFalse(assert_turn_content(document(evidence).replace(response, shortened), evidence)[0])

    def test_source_math_code_tables_and_numbered_lists_match_in_full(self):
        response = "波速v = \\frac{c}{\\sqrt{\\varepsilon_r}}。完整代码print('ok')\nvalue = '<br>'计算结论甲乙"
        evidence = [{'prompt': '推导并给出完整代码', 'response': response}]
        exported = """## 👤 You
推导并给出完整代码
## 🤖 Assistant
波速 $v = \\frac{c}{\\sqrt{\\varepsilon_r}}$。
1. 完整代码
```python
print('ok')
value = '<br>'
```
2. 计算结论

| 甲<br>乙 |
| --- |
"""
        self.assertTrue(assert_turn_content(exported, evidence)[0])
        for modified in (exported.replace('frac', 'sqrt'), exported.replace('v =', 'v +'),
                         exported.replace("print('ok')", "print('wrong')"),
                         exported.replace("value = '<br>'", "value + '<br>'"),
                         exported.replace('甲<br>乙', '甲')):
            self.assertFalse(assert_turn_content(modified, evidence)[0])

    def test_gemini_bold_and_source_chip_presentation_preserves_authored_body(self):
        response = "保存鱼类(Fish)和叶片(Leaf)的结构。完整结论print('[[1]]')value = 2 ** 3"
        evidence = [{'prompt': 'Explain the diagram.', 'response': response}]
        exported = """## 👤 You
Explain the diagram.
## 🤖 Assistant
保存**鱼类(Fish)和叶片(Leaf)**的结构。[\\[1\\]]完整结论
```python
print('[[1]]')
value = 2 ** 3
```

> 🌐 **Sources:**
> [1] [Example](https://example.com/source)
"""
        self.assertTrue(assert_turn_content(exported, evidence)[0])
        for changed in (exported.replace('完整结论', ''), exported.replace('2 ** 3', '2 * 3'),
                        exported.replace("print('[[1]]')", "print('[]')")):
            self.assertFalse(assert_turn_content(changed, evidence)[0])

    def test_authored_source_like_text_and_unpaired_operators_are_preserved(self):
        response = "The literal marker is [[1]]; write 2 ** 3 in prose."
        evidence = [{'prompt': 'Explain literals.', 'response': response}]
        self.assertTrue(assert_turn_content(document(evidence), evidence)[0])
        self.assertFalse(assert_turn_content(document(evidence).replace('[[1]]', ''), evidence)[0])
        self.assertFalse(assert_turn_content(document(evidence).replace('**', '*'), evidence)[0])

    def test_visible_literal_bold_delimiters_require_physical_source(self):
        response = '本表所有数值均为**【虚构示例】**（用于解释）。结论准确。'
        evidence = [{'prompt': 'Explain the table.', 'response': response}]
        exported = document(evidence).replace('**', r'\*\*')
        self.assertTrue(assert_turn_content(exported, evidence)[0])
        for changed in (exported.replace(r'\*\*', ''), exported.replace(r'\*\*', r'\*'),
                        exported.replace(r'\*\*【', '【'), exported.replace(r'】\*\*', '】'),
                        exported.replace('（', ''), exported.replace('结论准确。', ''),
                        exported.replace('虚构示例', '真实数据')):
            self.assertFalse(assert_turn_content(changed, evidence)[0])
        rendered = [{'prompt': 'Explain the table.', 'response': response.replace('**', '')}]
        self.assertTrue(assert_turn_content(exported.replace(r'\*\*', '**'), rendered)[0])

    def test_bold_spanning_math_and_code_keeps_literal_operators(self):
        response = r'真实分布 P 与模型 Q。示例 2**3。集合 |\Sigma|。'
        evidence = [{'prompt': 'Explain.', 'response': response}]
        body = r'**真实分布 $P$ 与模型 $Q$**。示例 **`2**3`**。集合 $\vert{}\Sigma\vert{}$。'
        exported = document(evidence).replace(response, body)
        self.assertTrue(assert_turn_content(exported, evidence)[0])
        for changed in (exported.replace('2**3', '2*3'), exported.replace('Sigma', 'Lambda'),
                        exported.replace('与模型', '')):
            self.assertFalse(assert_turn_content(changed, evidence)[0])

    def test_math_alias_normalization_never_changes_literal_code(self):
        code = r'print("\vert{}")'
        evidence = [{'prompt': 'Show code.', 'response': code, 'code_blocks': [code]}]
        exported = document(evidence).replace(code, f'```python\n{code}\n```')
        self.assertTrue(assert_turn_content(exported, evidence)[0])
        self.assertFalse(assert_turn_content(exported.replace(r'\vert{}', '|'), evidence)[0])

    def test_norm_bars_cannot_be_replaced_by_absolute_value_bars(self):
        formula = r'\|x\|_2 + |D(a,b,c)|'
        evidence = [{'prompt': 'Explain norms.', 'response': formula}]
        exported = document(evidence).replace(formula, f'${formula}$')
        self.assertTrue(assert_turn_content(exported, evidence)[0])
        self.assertFalse(assert_turn_content(exported.replace(r'\|x\|', '|x|'), evidence)[0])
        self.assertFalse(assert_turn_content(exported.replace('|D(a,b,c)|', r'\|D(a,b,c)\|'), evidence)[0])

    def test_norm_alias_canonicalization_only_applies_to_math(self):
        evidence = [{'prompt': 'Explain.', 'response': r'\|x\|_2'}]
        exported = document(evidence).replace(r'\|x\|_2', r'$\Vert{}x\Vert{}_2$')
        self.assertTrue(assert_turn_content(exported, evidence)[0])
        self.assertFalse(assert_turn_content(exported.replace('Vert', 'vert'), evidence)[0])
        literal = r'print("\Vert{}")'
        code_evidence = [{'prompt': 'Explain.', 'response': literal, 'code_blocks': [literal]}]
        code_export = document(code_evidence).replace(literal, f'```python\n{literal}\n```')
        self.assertTrue(assert_turn_content(code_export, code_evidence)[0])
        self.assertFalse(assert_turn_content(code_export.replace(r'\Vert{}', r'\|'), code_evidence)[0])

    def test_only_generated_trailing_source_metadata_is_excluded(self):
        evidence = [{'prompt': 'Explain the result.', 'response': 'Complete explanation.Final conclusion.'}]
        exported = "## 👤 You\nExplain the result.\n## 🤖 Assistant\nComplete explanation.[\\[1\\]]Final conclusion.\n\n> 🌐 **Sources:**\n> [1] [Article](https://example.com/article)\n"
        self.assertTrue(assert_turn_content(exported, evidence)[0])
        self.assertFalse(assert_turn_content(exported.replace('Final conclusion.', ''), evidence)[0])
        # Similar source prose inside the body and literal source footers in code
        # are authored content, rather than metadata to discard.
        for body in ('> 🌐 **Sources:**\n> [1] Article\n\nAfter the quoted sources.',
                     '```text\n🌐 Sources:\n[1] Article\n```'):
            expected = [{'prompt': 'Explain the result.', 'response': '🌐 Sources:[1] Article' + ('After the quoted sources.' if body.startswith('>') else '')}]
            self.assertTrue(assert_turn_content('## 👤 You\nExplain the result.\n## 🤖 Assistant\n'+body, expected)[0])

    def test_math_row_spacing_and_image_tile_labels_are_metadata_but_resources_are_required(self):
        formula = r'\begin{cases}a=1\\b=2\end{cases}'
        code = "if ready:\n    result = r'\\\\[2ex]'"
        evidence = [{'prompt': 'Explain the result.', 'response': 'Equation'+formula+'Program'+code+'Conclusion',
                     'has_images': True, 'code_blocks': [code]}]
        displayed = formula.replace('\\\\', '\\\\[2ex]')
        body = f'Equation\n$$\n{displayed}\n$$\nProgram\n```python\n{code}\n```\nConclusion\n\n![diagram.png](assets/diagram.png)\n\ndiagram.png\n'
        exported = document(evidence).replace(evidence[0]['response'], body)
        self.md.write_text(exported)
        self.assertFalse(self.check(evidence))  # metadata normalization cannot hide a missing asset
        (self.root/'assets').mkdir()
        (self.root/'assets/diagram.png').write_bytes(b'nonempty image bytes')
        self.assertTrue(self.check(evidence))
        for changed in (exported.replace('a=1', 'a=2'), exported.replace("result = r'\\\\[2ex]'", "result = r'\\\\[4ex]'"),
                        exported.replace('Conclusion', '')):
            self.assertFalse(assert_turn_content(changed, evidence)[0])

    def test_visible_code_indentation_and_line_boundaries_cannot_be_normalized_away(self):
        code = 'if ready:\n    run()\n    finish()'
        evidence = [{'prompt': 'Give runnable code.', 'response': 'Program'+code, 'code_blocks': [code]}]
        exported = document(evidence).replace(evidence[0]['response'], f'Program\n```python\n{code}\n```')
        self.assertTrue(assert_turn_content(exported, evidence)[0])
        for changed in (exported.replace('    run()', '  run()'), exported.replace('run()\n', 'run() '),
                        exported.replace('    finish()', '\tfinish()')):
            self.assertFalse(assert_turn_content(changed, evidence)[0])

    def test_execution_records_are_separate_and_require_exact_independent_dom_evidence(self):
        code = 'if ready:\n    run()\n\n\nfinish()'
        evidence = [{'prompt': 'Run and explain.', 'response': 'Final answer', 'code_blocks': [],
                     'execution_blocks': [{'code': code, 'stdout': 'result: 7\nsecond line'}]}]
        exported = document(evidence).replace('Final answer', f'```python?code_reference&code_event_index=1\n{code}\n```\n\n```text?code_stdout&code_event_index=1\nresult: 7\nsecond line\n```\n\nFinal answer')
        self.assertTrue(assert_turn_content(exported, evidence)[0])
        for changed in (exported.replace('    run()', '  run()'), exported.replace('result: 7', 'result: 8'),
                        exported.replace('Final answer', ''), exported.replace('\n\n\nfinish()', '\n\nfinish()')):
            self.assertFalse(assert_turn_content(changed, evidence)[0])
        no_execution_evidence = copy.deepcopy(evidence); no_execution_evidence[0]['execution_blocks'] = []
        self.assertFalse(assert_turn_content(exported, no_execution_evidence)[0])
        self.assertFalse(assert_turn_content(document(evidence), evidence)[0])

    def test_silent_execution_requires_exact_dom_source_and_cannot_hide_lost_stdout(self):
        code = '# This program intentionally emits no output.'
        evidence = [{'prompt': 'Execute.', 'response': 'Done.', 'code_blocks': [],
                     'execution_blocks': [{'code': code, 'stdout': ''}]}]
        exported = document(evidence).replace('Done.', f'```python?code_reference&code_event_index=1\n{code}\n```\n\nDone.')
        self.assertTrue(assert_turn_content(exported, evidence)[0])
        for changed in (exported.replace(code, '# different'), document(evidence), exported.replace('Done.', '')):
            self.assertFalse(assert_turn_content(changed, evidence)[0])
        has_output = copy.deepcopy(evidence)
        has_output[0]['execution_blocks'][0]['stdout'] = 'actual output'
        self.assertFalse(assert_turn_content(exported, has_output)[0])
        with self.assertRaises(subprocess.CalledProcessError):
            assert_turn_content(exported.replace('code_reference', 'code_stdout'), evidence)

    def test_execution_marker_inside_regular_code_is_authored_content(self):
        code = 'python?code_reference&code_event_index=1\nWas this visual helpful?'
        evidence = [{'prompt': 'Show the literal marker.', 'response': code, 'code_blocks': [code]}]
        exported = document(evidence).replace(code, f'```text\n{code}\n```')
        self.assertTrue(assert_turn_content(exported, evidence)[0])
        self.assertFalse(assert_turn_content(exported.replace('Was this visual helpful?', ''), evidence)[0])

    def test_real_retained_failure_sample_diagnosis_and_verification(self):
        evidence_dir = Path(__file__).resolve().parents[1] / "temp/codex_sync_repair_2026-10-10/final-evidence"
        if not evidence_dir.exists():
            return

        # 1. 验证保留的真实 5 轮超长回答样本 (material.md 与 material-dom.json)
        mat_dom = evidence_dir / "material-dom.json"
        mat_md = evidence_dir / "material.md"
        if mat_dom.exists() and mat_md.exists():
            dom_data = json.loads(mat_dom.read_text(encoding='utf-8'))
            md_text = mat_md.read_text(encoding='utf-8')
            # 确认第 5 轮为万字级真实超长回答
            self.assertGreater(len(dom_data[4]['response']), 10000)
            ok, msg = assert_turn_content(md_text, dom_data)
            self.assertTrue(ok, f"真实 5 轮超长样本断言应通过: {msg}")

        # 2. 诊断分析保留的真实差异样本 (settled-attempt/60c9b0834e0cf63f_turn_evidence.json)
        settled_ev_path = evidence_dir / "settled-attempt/60c9b0834e0cf63f_turn_evidence.json"
        if settled_ev_path.exists() and mat_md.exists():
            settled_data = json.loads(settled_ev_path.read_text(encoding='utf-8'))
            t1_settled = settled_data['turn_evidence'][0]['response']
            # 定位差异：证明测试采集中混入了非正文 mini-app / follow-up 交互控件
            self.assertIn("Was this visual helpful?", t1_settled)
            # 混入控件的样本必须被断言拦截，证明未放宽断言，而是准确拦截采集污染
            ok, msg = assert_turn_content(md_text, settled_data['turn_evidence'])
            self.assertFalse(ok)
            self.assertIn("第 1 轮真实 AI 回复全文不匹配", msg)


class ScanAndImportTests(unittest.TestCase):
    def fallback_fixture(self):
        baseline, before, scan, after = self.activity_fixture()
        for state in (baseline['state'], before, after):
            coverage = state['coverage']
            coverage.update(complete=True, lastStatus='complete', baseline={'headTimestamp': 100})
            coverage['streams']['pinned'] = {'initialized': True, 'historyComplete': True, 'range': None}
            coverage['streams']['recent'].update(historyComplete=True, range=None, orderingInvalidated=True)
        scan = scan_evidence()
        scan['response']['status'] = 'complete'
        scan['response']['diagnostics']['totalPagesFetched'] = 8
        return baseline, before, scan, after

    def test_order_invalidated_activity_requires_real_exhaustive_fallback_and_preserves_targets(self):
        baseline, before, scan, after = self.fallback_fixture()
        self.assertTrue(assert_followup_scan_result(scan, before['coverage'], after['coverage'])[0])
        self.assertTrue(assert_activity_sync_result(baseline, before, scan, after, [CID, OTHER])[0])
        self.assertFalse(assert_incremental_scan_result(scan, before['coverage'], after['coverage'])[0])
        attempted = copy.deepcopy(scan)
        attempted['response']['diagnostics']['incremental'] = True
        self.assertTrue(assert_followup_scan_result(attempted, before['coverage'], after['coverage'])[0])
        self.assertFalse(assert_full_scan_coverage(attempted, after['coverage'])[0])
        for change in ('partial', 'range', 'account', 'marker', 'status', 'target', 'archive'):
            ev, state = copy.deepcopy(scan), copy.deepcopy(after)
            if change == 'partial': ev['response']['diagnostics']['stopReason'] = 'Token loop'
            if change == 'range': state['coverage']['streams']['recent']['range'] = {'head': {'time': 100}, 'tail': {'time': 10}}
            if change == 'account': state['coverage']['accountId'] = 'other'
            if change == 'marker': state['coverage']['streams']['recent'].pop('orderingInvalidated')
            if change == 'status': ev['response']['status'] = 'up_to_date'
            if change == 'target': state['rows'] = [r for r in state['rows'] if r['id'] != OTHER]
            if change == 'archive': state['exportIds'] = []
            self.assertFalse(assert_activity_sync_result(baseline, before, ev, state, [CID, OTHER])[0], change)

    def test_incremental_requires_runtime_and_durable_same_account_closure(self):
        evidence = scan_evidence()
        evidence['response']['status'] = 'up_to_date'
        diag = evidence['response']['diagnostics']
        diag['incremental'] = True
        diag['stopReason'] = 'Connected to verified activity coverage'
        coverage = {'version': 3, 'providerId': 'gemini', 'accountId': 'a', 'generation': 'g',
                    'initialized': True, 'historyComplete': False, 'activeRunId': None, 'lastStatus': 'up_to_date',
                    'streams': {'recent': {'initialized': True, 'range': {'head': {'id': 'h', 'time': 100}, 'tail': {'id': 't', 'time': 10}}}}}
        self.assertTrue(assert_incremental_scan_result(evidence, coverage, copy.deepcopy(coverage))[0])
        for field in ('accountId', 'generation', 'historyComplete', 'activeRunId', 'lastStatus'):
            changed = copy.deepcopy(coverage)
            changed[field] = 'wrong'
            self.assertFalse(assert_incremental_scan_result(evidence, coverage, changed)[0], field)
        lost = copy.deepcopy(coverage)
        lost['streams']['recent']['range']['tail']['time'] = 20
        self.assertFalse(assert_incremental_scan_result(evidence, coverage, lost)[0])
        self.assertFalse(assert_incremental_scan_result(evidence, {}, coverage)[0])
        diag['stopReason'] = 'Token loop'
        self.assertFalse(assert_incremental_scan_result(evidence, coverage, coverage)[0])

    def activity_fixture(self):
        coverage = {'version': 3, 'providerId': 'gemini', 'accountId': 'a', 'generation': 'g',
                    'initialized': True, 'historyComplete': True, 'activeRunId': None, 'lastStatus': 'up_to_date',
                    'streams': {'recent': {'initialized': True, 'range': {
                        'head': {'id': CID, 'time': 100}, 'tail': {'id': 'tail', 'time': 10}}}}}
        initial = {'coverage': coverage, 'rows': [{'id': CID, 'timestamp': 100, 'titleSource': 'rpc'},
                    {'id': 'tail', 'timestamp': 10, 'titleSource': 'rpc'}], 'exportIds': [CID]}
        after = copy.deepcopy(initial)
        after['coverage']['streams']['recent']['range']['head'] = {'id': OTHER, 'time': 120}
        after['rows'][0]['timestamp'] = 110
        after['rows'].append({'id': OTHER, 'timestamp': 120, 'titleSource': 'rpc'})
        scan = scan_evidence()
        scan['response']['status'] = 'up_to_date'
        scan['response']['diagnostics'].update(incremental=True, stopReason='Connected to verified activity coverage')
        full = scan_evidence()
        full['response']['diagnostics']['totalPagesFetched'] = 8
        return {'state': initial, 'scan': full}, copy.deepcopy(initial), scan, after

    def test_natural_traversal_requires_durable_complete_coverage(self):
        baseline, _, _, _ = self.activity_fixture()
        coverage = copy.deepcopy(baseline['state']['coverage'])
        coverage.update(complete=True, lastStatus='complete')
        coverage['streams']['recent']['historyComplete'] = True
        coverage['streams']['pinned'] = {'initialized': True, 'historyComplete': True, 'range': None}
        self.assertTrue(assert_full_scan_coverage(baseline['scan'], coverage)[0])
        for field in ('historyComplete', 'complete', 'initialized'):
            broken = copy.deepcopy(coverage)
            broken[field] = False
            self.assertFalse(assert_full_scan_coverage(baseline['scan'], broken)[0], field)
        for stream in ('pinned', 'recent'):
            broken = copy.deepcopy(coverage)
            broken['streams'][stream]['historyComplete'] = False
            self.assertFalse(assert_full_scan_coverage(baseline['scan'], broken)[0], stream)
        broken = copy.deepcopy(coverage)
        broken['activeRunId'] = 'unfinished'
        self.assertFalse(assert_full_scan_coverage(baseline['scan'], broken)[0])
        partial = copy.deepcopy(baseline['scan'])
        partial['response']['diagnostics']['stopReason'] = 'rate limited'
        self.assertFalse(assert_full_scan_coverage(partial, coverage)[0])

    def test_passive_requires_actual_same_account_rpc_and_persisted_endpoints(self):
        baseline, _, _, _ = self.activity_fixture()
        after = copy.deepcopy(baseline['state'])
        after['coverage']['lastStatus'] = None
        pages = [{'streamId': 'recent', 'accountId': 'a', 'requestedAt': 1, 'truncated': False}]
        self.assertTrue(assert_passive_coverage({'coverage': None}, after, pages)[0])
        for changes in ({'accountId': 'other'}, {'requestedAt': 0}, {'truncated': True}, {'streamId': 'pinned'}):
            with self.subTest(changes=changes):
                self.assertFalse(assert_passive_coverage({'coverage': None}, after, [dict(pages[0], **changes)])[0])
        self.assertFalse(assert_passive_coverage({'coverage': None}, after, [])[0])
        for key, value in (('activeRunId', 'active'), ('lastStatus', 'up_to_date'), ('accountId', None)):
            broken = copy.deepcopy(after)
            broken['coverage'][key] = value
            self.assertFalse(assert_passive_coverage({'coverage': None}, broken, pages)[0], key)
        broken = copy.deepcopy(after)
        broken['rows'] = []
        self.assertFalse(assert_passive_coverage({'coverage': None}, broken, pages)[0])
        broken = copy.deepcopy(after)
        broken['coverage']['streams']['recent']['range']['tail']['time'] = 101
        self.assertFalse(assert_passive_coverage({'coverage': None}, broken, pages)[0])

    def test_passive_setup_waits_for_onboarding_scan_to_settle(self):
        cdp = MagicMock()
        cdp.eval.side_effect = [True, False, False]
        with patch('scripts.framework.cases.sync.read_sync_state', side_effect=[
                {'coverage': None}, {'coverage': {'activeRunId': 'running'}},
                {'coverage': {'activeRunId': None, 'lastStatus': 'complete'}}]), \
                patch('scripts.framework.cases.sync.time.sleep') as sleep:
            wait_for_prior_scan(cdp)
        self.assertEqual(sleep.call_count, 2)
        with patch('scripts.framework.cases.sync.time.monotonic', side_effect=[0, 331]):
            with self.assertRaisesRegex(RuntimeError, 'did not settle'):
                wait_for_prior_scan(cdp)

    def test_activity_sync_requires_new_and_promoted_activity_with_shorter_scan(self):
        baseline, before, scan, after = self.activity_fixture()
        self.assertTrue(assert_activity_sync_result(baseline, before, scan, after, [CID, OTHER])[0])
        for cid in (CID, OTHER):
            broken = copy.deepcopy(after)
            row = next(row for row in broken['rows'] if row['id'] == cid)
            row['timestamp'] = 100
            self.assertFalse(assert_activity_sync_result(baseline, before, scan, broken, [cid])[0])
        for key in ('accountId', 'generation'):
            broken = copy.deepcopy(baseline)
            broken['state']['coverage'][key] = 'wrong'
            self.assertFalse(assert_activity_sync_result(broken, before, scan, after, [CID])[0])
        broken = copy.deepcopy(after)
        broken['coverage']['streams']['recent']['range']['head']['time'] = 100
        self.assertFalse(assert_activity_sync_result(baseline, before, scan, broken, [OTHER])[0])
        broken = copy.deepcopy(scan)
        broken['response']['diagnostics']['totalPagesFetched'] = 8
        self.assertFalse(assert_activity_sync_result(baseline, before, broken, after, [OTHER])[0])
        broken['response']['diagnostics']['stopReason'] = 'Token loop'
        self.assertFalse(assert_activity_sync_result(baseline, before, broken, after, [OTHER])[0])

    def test_activity_sync_preserves_partial_coverage_without_claiming_complete(self):
        baseline, before, scan, after = self.activity_fixture()
        for state in (baseline['state'], before, after):
            state['coverage']['historyComplete'] = False
        self.assertTrue(assert_activity_sync_result(baseline, before, scan, after, [OTHER])[0])
        after['coverage']['historyComplete'] = True
        self.assertFalse(assert_activity_sync_result(baseline, before, scan, after, [OTHER])[0])

    def test_activity_sync_cannot_prune_archives_or_export_records(self):
        baseline, before, scan, after = self.activity_fixture()
        for key in ('rows', 'exportIds'):
            broken = copy.deepcopy(after)
            broken[key] = [row for row in broken[key] if not isinstance(row, dict) or row['id'] != 'tail'] if key == 'rows' else []
            self.assertFalse(assert_activity_sync_result(baseline, before, scan, broken, [OTHER])[0], key)
        before['rows'].append({'id': 'offline-only', 'timestamp': 5})
        self.assertFalse(assert_activity_sync_result(baseline, before, scan, after, [OTHER])[0])

    def test_complete_fast_scan_passes_without_sampling_busy_state(self):
        self.assertTrue(assert_scan_result(scan_evidence())[0])
        cdp = MagicMock()
        cdp.eval.side_effect = [{'clicked': True}, scan_evidence(), None]
        self.assertTrue(assert_scan_result(CDPActions.trigger_deep_scan(cdp))[0])

    def test_idle_unstarted_failed_and_partial_scans_fail(self):
        for change in ('started', 'finished', 'success', 'limit', 'incremental', 'reason', 'diagnostics'):
            with self.subTest(change=change):
                e = scan_evidence()
                if change in ('started', 'finished'): e[change] = False
                elif change == 'success': e['response']['success'] = False
                elif change == 'limit': e['response']['hitGoogleLimit'] = True
                elif change == 'incremental': e['response']['diagnostics']['incremental'] = True
                elif change == 'reason': e['response']['diagnostics']['stopReason'] = '已达到最大页数限制 (150 页)'
                else: e['response']['diagnostics'] = {}
                self.assertFalse(assert_scan_result(e)[0])
        cdp = MagicMock()
        cdp.eval.return_value = {'error': 'button missing'}
        self.assertFalse(assert_scan_result(CDPActions.trigger_deep_scan(cdp))[0])

    def test_click_without_bound_handler_does_not_pass(self):
        cdp = MagicMock()
        cdp.eval.side_effect = [{'clicked': True}, {'started': False}, None]
        with patch('scripts.framework.actions.time.monotonic', side_effect=[0, 0, 4]):
            result = CDPActions.trigger_deep_scan(cdp)
        self.assertFalse(assert_scan_result(result)[0])

    def test_all_matched_titles_must_upgrade(self):
        cdp = MagicMock()
        first = {'id': CID, 'title': 'Online title', 'source': 'rpc', 'titles': {'takeout': 'Offline', 'rpc': 'Online title'}}
        second = {'id': OTHER, 'title': 'Offline', 'source': 'takeout', 'titles': {'takeout': 'Offline'}}
        cdp.eval.return_value = {'matched': [first, second]}
        self.assertFalse(CDPAssertions.assert_title_upgraded(cdp, [CID, OTHER])[0])
        cdp.eval.return_value = {'matched': [first]}
        self.assertFalse(CDPAssertions.assert_title_upgraded(cdp, [CID, OTHER])[0])
        self.assertTrue(CDPAssertions.assert_title_upgraded(cdp, [CID])[0])  # offline-only sample excluded

    def test_takeout_empty_import_and_missing_resources_fail_idempotent_passes(self):
        media = {'image.png': hashlib.sha256(b'image bytes').hexdigest()}
        record = {'id': CID, 'ok': True, 'summary': {'titles': {'takeout': 'Prompt'}},
                  'domain': {'id': CID, 'providerId': 'gemini', 'messages': [
                      {'role': 'user', 'content': [{'text': 'Prompt'}]}, {'role': 'assistant', 'content': [{'text': 'Answer'}]}]},
                  'resources': [{'sourcePath': 'Takeout/image.png', 'bytes': base64.b64encode(b'image bytes').decode()}]}
        self.assertTrue(validate_takeout_records([CID], media, [record])[0])
        self.assertFalse(validate_takeout_records([CID], media, [])[0])
        for key in ('messages', 'resources', 'summary'):
            broken = copy.deepcopy(record)
            if key == 'messages': broken['domain']['messages'] = []
            else: broken[key] = [] if key == 'resources' else {}
            self.assertFalse(validate_takeout_records([CID], media, [broken])[0])
        broken = copy.deepcopy(record)
        broken['domain']['messages'][0]['content'] = [{'type': 'paragraph', 'children': []}]
        self.assertFalse(validate_takeout_records([CID], media, [broken])[0])

    def test_takeout_case_accepts_real_readable_reimport_with_zero_added(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'takeout.zip'
            with zipfile.ZipFile(path, 'w') as zf:
                zf.writestr('Takeout/MyActivity.html', f'<a href="https://gemini.google.com/app/{CID}">Chat</a>')
                zf.writestr('Takeout/README.txt', 'Unreferenced archive metadata is not a conversation resource.')
            ctx = MagicMock(takeout_zip=str(path))
            ctx.shared_data = {}
            cdp = ctx.connect_options.return_value
            cdp.eval.return_value = [{'id': CID, 'ok': True, 'summary': {'titles': {'takeout': 'Prompt'}},
                'domain': {'id': CID, 'providerId': 'gemini', 'messages': [
                    {'role': 'user', 'content': [{'text': 'Prompt'}]}, {'role': 'assistant', 'content': [{'text': 'Answer'}]}]}, 'resources': []}]
            result = {'success': True, 'importedIds': [CID], 'status': 'ok', 'addedCount': 0}
            with patch.object(CDPActions, 'import_takeout_zip', return_value=result):
                self.assertTrue(TakeoutZipImportCase().execute(ctx)[0])
                cdp.eval.return_value = []
                self.assertFalse(TakeoutZipImportCase().execute(ctx)[0])

    def test_empty_image_reply_requires_source_recorded_generation(self):
        record = {'id': CID, 'ok': True, 'summary': {'titles': {'takeout': 'Draw'}},
                  'domain': {'id': CID, 'providerId': 'gemini', 'messages': [
                      {'role': 'user', 'content': [{'text': 'Draw'}]},
                      {'role': 'assistant', 'content': [], 'generation': {'mediaKind': 'image', 'outputCount': 1}}]},
                  'resources': []}
        self.assertFalse(validate_takeout_records([CID], {}, [record])[0])
        self.assertTrue(validate_takeout_records([CID], {}, [record], {CID})[0])
        record['domain']['messages'][1]['generation']['outputCount'] = 0
        self.assertFalse(validate_takeout_records([CID], {}, [record], {CID})[0])

    def test_takeout_resource_count_cannot_replace_readable_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'takeout.zip'
            with zipfile.ZipFile(path, 'w') as zf:
                zf.writestr('Takeout/MyActivity.html', f'<div class="outer-cell">Prompted Draw<br>1 generated image.<a href="https://gemini.google.com/app/{CID}">Chat</a></div>')
                zf.writestr('Takeout/media.png', b'Image bytes')
            ctx = MagicMock(takeout_zip=str(path))
            ctx.shared_data = {}
            ctx.connect_options.return_value.eval.return_value = [{'id': CID, 'ok': True,
                'summary': {'titles': {'takeout': 'Draw'}}, 'domain': {'id': CID, 'providerId': 'gemini', 'messages': [
                    {'role': 'user', 'content': [{'text': 'Draw'}]},
                    {'role': 'assistant', 'content': [], 'generation': {'mediaKind': 'image', 'outputCount': 1}}]}, 'resources': []}]
            res = {'success': True, 'importedIds': [CID], 'status': 'ok', 'totalMediaCount': 1}
            with patch.object(CDPActions, 'import_takeout_zip', return_value=res):
                self.assertFalse(TakeoutZipImportCase().execute(ctx)[0])
                res['mediaDigests'] = {'Takeout/media.png': hashlib.sha256(b'Image bytes').hexdigest()}
                self.assertTrue(TakeoutZipImportCase().execute(ctx)[0])


class CoverageTests(unittest.TestCase):
    def test_missing_required_scenario_is_not_consumed_as_generic(self):
        with tempfile.TemporaryDirectory() as directory:
            pool, archive = Path(directory) / 'pool.json', Path(directory) / 'archive.json'
            pool.write_text(json.dumps([{'id': 'text', 'features': ['code'], 'turns': ['one', 'two']}]))
            OnlineScenarioProvider.reset()
            provider = OnlineScenarioProvider(str(pool), str(archive))
            try:
                with self.assertRaises(RuntimeError): provider.pop_scenario(['imagen'])
                self.assertEqual(len(json.loads(pool.read_text())), 1)
                self.assertFalse(archive.exists())
            finally:
                OnlineScenarioProvider.reset()

    def test_custom_dataset_and_imagen_case_require_real_image_scenario(self):
        ctx = TestContext(dataset=[{'turns': ['one', 'two']}, {'turns': ['one', 'two']}])
        with self.assertRaises(RuntimeError): ctx.ensure_scenarios()
        self.assertFalse(ImagenMultimodalCase().execute(ctx)[0])
        ctx.scenarios[0]['features'] = ['imagen']
        self.assertFalse(ImagenMultimodalCase().execute(ctx)[0])
        ctx.shared_data.update(imagen_found=True, imagen_chat_id=CID)
        ctx.chat_records = [{'chat_id': CID, 'turn_evidence': [{'has_images': True}]}]
        self.assertTrue(ImagenMultimodalCase().execute(ctx)[0])

    def test_actual_turn_identity_is_bound_to_context(self):
        ctx = TestContext()
        record = {'chat_id': CID}
        with self.assertRaises(RuntimeError): ctx.record_turn(record, TurnResult(True, 'Prompt', REPLY, chat_id=OTHER))
        ctx.record_turn(record, TurnResult(True, 'Actual prompt', REPLY, chat_id=CID))
        self.assertEqual(record['turn_evidence'][0]['prompt'], 'Actual prompt')

    def test_export_zip_must_contain_required_ids_and_exclude_exported(self):
        self.assertTrue(assert_archive_targets([f'Chat_{CID[-6:]}.html'], [CID], '.html')[0])
        self.assertFalse(assert_archive_targets([f'Chat_{OTHER[-6:]}.html'], [CID], '.html')[0])
        self.assertFalse(assert_archive_targets([f'Chat_{CID[-6:]}.md', f'Old_{OTHER[-6:]}.md'], [CID], '.md', [OTHER])[0])

    def test_missing_format_target_fails_before_download(self):
        ctx = MagicMock()
        ctx.chat_records = [{'chat_id': CID}]
        ctx.connect_options.return_value.eval.return_value = {'matched': [OTHER], 'missing': [CID]}
        with self.assertRaises(RuntimeError): select_format_targets(ctx.connect_options(), ctx, 'html')

    def test_html_and_pdf_cases_reject_wrong_archive_targets(self):
        for case, extension in ((HtmlExportDownloadCase(), '.html'), (PdfExportDownloadCase(), '.pdf')):
            with self.subTest(extension=extension), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'export.zip'
                with zipfile.ZipFile(path, 'w') as zf: zf.writestr(f'Wrong_{OTHER[-6:]}{extension}', 'nonempty content')
                ctx = MagicMock(output_dir=directory)
                ctx.chat_records = [{'chat_id': CID}]
                with patch('scripts.framework.cases.export.select_format_targets', return_value={'matched': [CID]}), \
                     patch.object(CDPActions, 'trigger_export_zip', return_value=str(path)), \
                     patch.object(CDPActions, 'clear_search_workbench'):
                    self.assertFalse(case.execute(ctx)[0])

    def test_html_pdf_restore_markdown_format_on_failure(self):
        # FAIL 路径也必须走 finally 恢复默认 markdown，避免污染后序用例的格式状态
        for case, extension in ((HtmlExportDownloadCase(), '.html'), (PdfExportDownloadCase(), '.pdf')):
            with self.subTest(extension=extension), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'export.zip'
                with zipfile.ZipFile(path, 'w') as zf: zf.writestr(f'Wrong_{OTHER[-6:]}{extension}', 'nonempty content')
                ctx = MagicMock(output_dir=directory)
                ctx.chat_records = [{'chat_id': CID}]
                cdp = ctx.connect_options.return_value
                with patch('scripts.framework.cases.export.select_format_targets', return_value={'matched': [CID]}), \
                     patch.object(CDPActions, 'trigger_export_zip', return_value=str(path)), \
                     patch.object(CDPActions, 'clear_search_workbench'):
                    self.assertFalse(case.execute(ctx)[0])
                scripts = [str(call.args[0]) for call in cdp.eval.call_args_list]
                self.assertTrue(any('markdown' in s for s in scripts),
                                f"{extension} FAIL 后必须恢复 markdown 格式")

    def test_zip_export_resets_skip_exported_switch(self):
        # 与 FastSkip 解耦后，ZIP 用例启动时必须关闭残留 skip 开关（脚本级断言，不跑真实导出）
        from scripts.framework.cases.export import ZipExportDownloadCase
        with tempfile.TemporaryDirectory() as directory:
            ctx = MagicMock(output_dir=directory)
            ctx.chat_records = []
            cdp = ctx.connect_options.return_value
            cdp.eval.return_value = {}
            with patch.object(CDPActions, 'clear_search_workbench'), \
                 patch.object(CDPActions, 'trigger_export_zip'):
                ZipExportDownloadCase().execute(ctx)
            scripts = [str(call.args[0]) for call in cdp.eval.call_args_list]
            self.assertTrue(any('skipExported' in s and 'checked = false' in s for s in scripts),
                            "ZIP 启动时必须显式关闭 skipExported")

    def test_partial_skip_requires_both_states_and_exact_zip_contents(self):
        for partial, zip_ids, expected in (({'exportedId': OTHER}, [CID], False),
                                         ({'exportedId': OTHER, 'unexportedId': CID}, [CID, OTHER], False),
                                         ({'exportedId': OTHER, 'unexportedId': CID}, [CID], True)):
            with self.subTest(partial=partial, zip_ids=zip_ids), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'partial.zip'
                with zipfile.ZipFile(path, 'w') as zf:
                    for cid in zip_ids: zf.writestr(f'Chat_{cid[-6:]}.md', document(cid=cid))
                ctx = MagicMock(output_dir=directory)
                ctx.connect_options.return_value.eval.side_effect = [
                    {'count': 6, 'log': 'old'}, True, {'busy': False, 'log': 'old skipped'}, partial]
                with patch.object(CDPActions, 'clear_search_workbench'), \
                     patch.object(CDPActions, 'trigger_export_zip', return_value=str(path)):
                    self.assertEqual(FastSkipExportedCase().execute(ctx)[0], expected)

    def test_report_never_calls_skip_or_noncritical_failure_all_passed(self):
        registry = FeatureRegistry()
        for feature in registry.all_features(): registry.record_result(feature.id, TestStatus.PASS)
        self.assertIn('ALL PASSED', registry.generate_matrix_report())
        registry.record_result('feat_uninstall_lifecycle', TestStatus.SKIP)
        self.assertNotIn('ALL PASSED', registry.generate_matrix_report())
        registry.record_result('feat_uninstall_lifecycle', TestStatus.FAIL)
        self.assertNotIn('ALL PASSED', registry.generate_matrix_report())

    def test_critical_failure_and_dependent_skip_fail_runner(self):
        class Case(FeatureTestCase):
            def execute(self, ctx): return False, 'Injected failure', None
        dag = DAGRunner()
        dag.register(Case('critical', FeatureDomain.TAKEOUT, 'critical', 'critical'))
        dag.register(Case('dependent', FeatureDomain.TAKEOUT, 'dependent', 'dependent', prerequisites=['critical']))
        ctx = TestContext()
        with patch('sys.stdout', new=io.StringIO()): self.assertFalse(dag.run(ctx))
        self.assertEqual(ctx.registry.get_result('dependent').status, TestStatus.SKIP)


class SearchSelectionCounterexamples(unittest.TestCase):
    """搜索/选择反向验证：错误命中、漏选、选中失败必须 FAIL（直接测断言输入输出）。"""

    def cdp(self, snapshot):
        cdp = MagicMock()
        cdp.eval.return_value = snapshot
        return cdp

    def snap(self, items):
        return {"visibleItems": items}

    def item(self, cid, title):
        return {"id": cid, "title": title}

    def test_keyword_mode_rejects_mismatch(self):
        bad = self.snap([self.item("aaa", "Python 性能优化指南"), self.item("bbb", "量子计算的基本原理")])
        ok, msg, _ = CDPAssertions.assert_search_filter(self.cdp(bad), "Python", timeout=0.2)
        self.assertFalse(ok, f"误匹配必须 FAIL: {msg}")
        good = self.snap([self.item("aaa", "Python 性能优化指南"), self.item("ccc", "Python 并发模型")])
        self.assertTrue(CDPAssertions.assert_search_filter(self.cdp(good), "Python", timeout=0.2)[0])
        self.assertFalse(CDPAssertions.assert_search_filter(self.cdp(self.snap([])), "Python", timeout=0.2)[0])

    def test_id_set_mode_rejects_wrong_extra_missing(self):
        cases = [
            ([self.item(OTHER, "t " + CID)], False),  # 错误 ID
            ([self.item(CID, "t " + CID), self.item(OTHER, "t " + CID + " collision")], False),  # 额外命中
            ([], False),  # 遗漏结果
            ([self.item(CID, "t " + CID)], True),  # 正确唯一命中
            ([self.item("c_" + CID, "t " + CID)], True),  # c_ 前缀归一化后一致
        ]
        for i, (items, expected) in enumerate(cases):
            with self.subTest(i=i):
                got = CDPAssertions.assert_search_filter(
                    self.cdp(self.snap(items)), CID, expected_ids=[CID], timeout=0.2)[0]
                self.assertEqual(got, expected)

    def test_id_set_mode_ignores_order(self):
        ids = [CID, OTHER]
        snap = self.snap([self.item(OTHER, "t"), self.item(CID, "t")])
        self.assertTrue(
            CDPAssertions.assert_search_filter(self.cdp(snap), CID, expected_ids=list(reversed(ids)), timeout=0.2)[0])

    def test_id_set_mode_rejects_duplicate_ids(self):
        dup_visible = self.snap([self.item(CID, "t"), self.item(CID, "t")])
        self.assertFalse(
            CDPAssertions.assert_search_filter(self.cdp(dup_visible), CID, expected_ids=[CID], timeout=0.2)[0])
        self.assertFalse(
            CDPAssertions.assert_search_filter(
                self.cdp(self.snap([self.item(CID, "t")])), CID, expected_ids=[CID, CID], timeout=0.2)[0])

    def run_search_id(self, visible_items, select_ret, is_checked):
        from scripts.framework.cases.workbench import SearchIdCase
        cdp = MagicMock()

        def dispatch(script, *a, **k):
            text = str(script)
            if "visibleItems" in text:
                return dict(self.snap(visible_items))
            if "input[type=checkbox]:checked" in text:
                return is_checked
            if "dataset.chatId" in text:
                return CID
            return None
        cdp.eval.side_effect = dispatch
        ctx = MagicMock()
        ctx.shared_data = {}
        ctx.connect_options.return_value = cdp
        with patch.object(CDPActions, "search_workbench", return_value=1), \
             patch.object(CDPActions, "select_workbench_item", return_value=select_ret):
            return SearchIdCase().execute(ctx)

    def test_search_id_case_rejects_failed_selection(self):
        good = [self.item(CID, "t " + CID)]
        self.assertFalse(self.run_search_id(good, False, True)[0])  # 勾选操作失败
        self.assertFalse(self.run_search_id(good, True, False)[0])  # 实际未选中
        self.assertFalse(self.run_search_id([self.item(OTHER, "t " + CID)], True, True)[0])  # 错误命中
        self.assertTrue(self.run_search_id(good, True, True)[0])

    def run_selection(self, none_snapshot, all_snapshot):
        from scripts.framework.cases.workbench import SelectionControlsCase
        ctx = MagicMock()
        ctx.connect_options.return_value = MagicMock()
        with patch.object(CDPActions, "clear_search_workbench", return_value=3), \
             patch.object(CDPActions, "toggle_select_none", return_value=None), \
             patch.object(CDPActions, "toggle_select_all", return_value=None), \
             patch.object(CDPAssertions, "assert_selection_state", side_effect=[none_snapshot, all_snapshot]):
            return SelectionControlsCase().execute(ctx)

    def sel(self, selectable, selected):
        return {"selectable": selectable, "selected": selected}

    def test_selection_controls_rejects_partial_and_residue(self):
        full = self.sel(["a", "b", "c"], ["a", "b", "c"])
        # 全选漏选 → FAIL；取消残留 → FAIL；正确 → PASS
        self.assertFalse(self.run_selection(
            self.sel(["a", "b", "c"], []), self.sel(["a", "b", "c"], ["a", "b"]))[0])
        self.assertFalse(self.run_selection(
            self.sel(["a", "b", "c"], ["a"]), full)[0])
        self.assertTrue(self.run_selection(self.sel(["a", "b", "c"], []), full)[0])
        # 全选后列表为空（可选集合为空）→ FAIL，杜绝空集恒等误通过
        self.assertFalse(self.run_selection(
            self.sel(["a", "b", "c"], []), self.sel([], []))[0])
        # 禁用项不参与：可选集之外的禁用已选项不影响判定
        self.assertTrue(self.run_selection(
            self.sel(["a", "b"], []), self.sel(["a", "b"], ["a", "b"]))[0])


if __name__ == '__main__':
    unittest.main()
