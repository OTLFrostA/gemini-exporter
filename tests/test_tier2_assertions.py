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

    def test_role_headings_inside_code_are_not_turns(self):
        text = document().replace(REPLY, '```markdown\n## 👤 You\n```\n' + REPLY)
        self.assertTrue(assert_turn_content(text, EVIDENCE)[0])

    def test_short_actual_answer_requires_its_whole_body(self):
        evidence = [{'prompt': '给一句建议', 'response': '以真实负载验证容量上限。', 'has_images': False}]
        self.assertTrue(assert_turn_content(document(evidence), evidence)[0])
        self.assertFalse(assert_turn_content(document(evidence).replace('以真实负载验证容量上限。', '验证容量。'), evidence)[0])


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
