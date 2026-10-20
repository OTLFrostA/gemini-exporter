"""Counterexamples for PDF per-turn preservation; no product renderer oracle."""
import copy
import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.framework.pdf_evidence import assert_pdf_turn_content

EVIDENCE = [
    {'prompt': 'First prompt.', 'response': 'First sentence. Middle sentence. Final sentence.',
     'pdf_segments': [{'kind': 'text', 'text': 'First sentence. Middle sentence. Final sentence.'}]},
    {'prompt': 'Second prompt.', 'response': '计算比值x/y。Code:if x < 3:\n    print("中文")结束。',
     'pdf_segments': [{'kind': 'text', 'text': '计算比值'}, {'kind': 'math', 'text': 'x/y'},
                      {'kind': 'text', 'text': '。Code:'}, {'kind': 'code', 'text': 'if x < 3:\n    print("中文")'},
                      {'kind': 'text', 'text': '结束。'}], 'has_images': True},
]
INFO = {'imageXObjectCount': 1, 'contentRuns': [
    {'kind': 'text', 'text': 'Conversation metadata. First prompt. First sentence. Middle sentence. Final sentence. Second prompt.计算比值'},
    {'kind': 'math', 'text': '𝑥𝑦', 'group': 2},
    {'kind': 'text', 'text': '。Code:Python Copy'},
    {'kind': 'code', 'text': 'if x < 3:    print("中文")', 'group': 3},
    {'kind': 'text', 'text': '结束。'},
]}


class PdfEvidenceTests(unittest.TestCase):
    def test_adjacent_table_cell_asterisks_are_not_bold_delimiters(self):
        # Live LL(1) trace: one cell ends in *, the following cell starts in *.
        segments = [{'kind': 'text', 'text': value} for value in ["19", "$ E' T' F *", "* id $", "Match terminal *"]]
        evidence = [{'prompt': 'Trace.', 'response': ''.join(s['text'] for s in segments), 'pdf_segments': segments}]
        info = {'contentRuns': [{'kind': 'text', 'text': "Trace.19$ E' T' F ** id $Match terminal *"}]}
        self.assertTrue(assert_pdf_turn_content(info, evidence)[0])
        for wrong in ["Trace.19$ E' T' F * id $Match terminal *", "Trace.19$ E' T' F ** id $Match terminal +"]:
            self.assertFalse(assert_pdf_turn_content({'contentRuns': [{'kind': 'text', 'text': wrong}]}, evidence)[0])

    def test_normal_multilingual_formula_code_and_image(self):
        self.assertTrue(assert_pdf_turn_content(INFO, EVIDENCE)[0])

    def test_middle_tail_turn_loss_replacement_and_role_order_fail(self):
        for old, new in [('Middle sentence.', ''), ('Final sentence.', ''),
                         ('First sentence. Middle sentence. Final sentence.', ''),
                         ('First prompt.', 'Second prompt.'),
                         ('Second prompt.', 'First prompt.'),
                         ('Second prompt.计算比值', 'Second prompt.First sentence.')]:
            info = copy.deepcopy(INFO)
            info['contentRuns'][0]['text'] = info['contentRuns'][0]['text'].replace(old, new)
            with self.subTest(old=old):
                self.assertFalse(assert_pdf_turn_content(info, EVIDENCE)[0])

    def test_code_operators_formulas_and_images_are_required(self):
        for index, value in [(1, ''), (3, 'if x > 3: print("中文")')]:
            info = copy.deepcopy(INFO); info['contentRuns'][index]['text'] = value
            self.assertFalse(assert_pdf_turn_content(info, EVIDENCE)[0])
        info = copy.deepcopy(INFO); info['contentRuns'].pop(1)
        self.assertFalse(assert_pdf_turn_content(info, EVIDENCE)[0])
        info = copy.deepcopy(INFO); info['imageXObjectCount'] = 0
        self.assertFalse(assert_pdf_turn_content(info, EVIDENCE)[0])

    def test_full_source_segments_cannot_silently_omit_content(self):
        for bad in ([], EVIDENCE[1]['pdf_segments'][:-1]):
            ev = copy.deepcopy(EVIDENCE); ev[1]['pdf_segments'] = bad
            self.assertFalse(assert_pdf_turn_content(INFO, ev)[0])
        ev = copy.deepcopy(EVIDENCE); ev[1].pop('pdf_segments')
        self.assertFalse(assert_pdf_turn_content(INFO, ev)[0])

    def test_duplicate_formula_is_not_hidden_by_grouping(self):
        info = copy.deepcopy(INFO)
        info['contentRuns'].insert(2, dict(info['contentRuns'][1], group=99))
        self.assertFalse(assert_pdf_turn_content(info, EVIDENCE)[0])

    def test_duplicate_previous_reply_is_not_a_valid_next_reply(self):
        info = copy.deepcopy(INFO)
        info['contentRuns'] = info['contentRuns'][:1]
        info['contentRuns'][0]['text'] = 'First prompt. First sentence. Middle sentence. Final sentence. Second prompt. First sentence. Middle sentence. Final sentence.'
        self.assertFalse(assert_pdf_turn_content(info, EVIDENCE)[0])

    def test_repeated_authored_paragraphs_are_not_reused_as_evidence(self):
        ev = [{'prompt': 'Question.', 'response': 'Repeated.Repeated.', 'pdf_segments': [
            {'kind': 'text', 'text': 'Repeated.'}, {'kind': 'text', 'text': 'Repeated.'}]}]
        self.assertFalse(assert_pdf_turn_content({'contentRuns': [{'kind': 'text', 'text': 'Question.Repeated.'}]}, ev)[0])


if __name__ == '__main__':
    unittest.main()
