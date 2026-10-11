"""Counterexamples for the existing Tier 2 cases; no Google/network required."""
import base64
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.framework.assertions import (
    CDPAssertions, assert_archive_targets, assert_scan_result, assert_turn_content,
)
from scripts.framework.actions import CDPActions
from scripts.framework.cases.base import TestContext, DAGRunner, FeatureTestCase
from scripts.framework.cases.chat import ImagenMultimodalCase
from scripts.framework.cases.export import (
    LiveSaveNewChatCase, HtmlExportDownloadCase, PdfExportDownloadCase,
    FastSkipExportedCase, select_format_targets,
)
from scripts.framework.cases.takeout import validate_takeout_records, TakeoutZipImportCase
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

    def test_role_headings_inside_code_are_not_turns(self):
        evidence = [{'prompt': EVIDENCE[0]['prompt'], 'response': '## 👤 You\n' + REPLY}]
        text = document().replace(REPLY, '```markdown\n## 👤 You\n```\n' + REPLY)
        self.assertTrue(assert_turn_content(text, evidence)[0])

    def test_short_actual_answer_requires_its_whole_body(self):
        evidence = [{'prompt': '给一句建议', 'response': '以真实负载验证容量上限。', 'has_images': False}]
        self.assertTrue(assert_turn_content(document(evidence), evidence)[0])
        self.assertFalse(assert_turn_content(document(evidence).replace('以真实负载验证容量上限。', '验证容量。'), evidence)[0])

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

    def test_execution_marker_inside_regular_code_is_authored_content(self):
        code = 'python?code_reference&code_event_index=1\nWas this visual helpful?'
        evidence = [{'prompt': 'Show the literal marker.', 'response': code, 'code_blocks': [code]}]
        exported = document(evidence).replace(code, f'```text\n{code}\n```')
        self.assertTrue(assert_turn_content(exported, evidence)[0])
        self.assertFalse(assert_turn_content(exported.replace('Was this visual helpful?', ''), evidence)[0])


class ScanAndImportTests(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
