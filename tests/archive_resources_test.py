import tempfile
import unittest
from pathlib import Path
from scripts.framework.archive_resources import find_archive_resource, resolve_archive_reference, validate_archive_resources


class ArchiveResourcesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'files/nested').mkdir(parents=True)
        (self.root / 'files/foo.md').write_text('attachment')
        (self.root / 'files/nested/a b.pdf').write_bytes(b'PDF')
        (self.root / 'files/empty').touch()

    def test_exact_document_relative(self):
        self.assertEqual(resolve_archive_reference('exports/chat.html', '../files/foo.md'), 'files/foo.md')
        self.assertTrue(find_archive_resource(self.root, 'chat.html', 'files/foo.md'))
        self.assertTrue(find_archive_resource(self.root, 'exports/chat.md', '../files/nested/a%20b.pdf?x=1#part'))

    def test_wrong_directory_missing_empty_and_traversal(self):
        for ref in ('assets/files/foo.md', 'files/missing', 'files/empty', '../../foo', '%2e%2e/foo', '/files/foo.md', 'C:/files/foo.md', '..\\foo'):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                find_archive_resource(self.root, 'chat.html', ref)

    def test_html_and_markdown_attachment_false_green(self):
        # cb8bd7: same basename elsewhere cannot satisfy the broken href.
        for html, content in ((True, '<a href="assets/files/foo.md">foo</a>'), (False, '[foo](assets/files/foo.md)')):
            self.assertEqual(len(validate_archive_resources(self.root, 'cb8bd7.html' if html else 'cb8bd7.md', content, html)), 1)
            self.assertEqual(validate_archive_resources(self.root, 'chat.html' if html else 'chat.md', content.replace('assets/files/', 'files/'), html), [])

    def test_real_attachment_reference_regressions(self):
        # Reference strings from the archived cb8bd7 and 2b4994 exports.
        for filename in ('cb8bd7_test_config.json', '2b4994_============================================================.md'):
            (self.root / 'files' / filename).write_text('nonempty attachment')
            broken = f'<a href="assets/files/{filename}">attachment</a>'
            self.assertEqual(len(validate_archive_resources(self.root, 'chat.html', broken, True)), 1)
            self.assertEqual(validate_archive_resources(self.root, 'chat.html', broken.replace('assets/files/', 'files/'), True), [])

    def test_all_html_resource_tags(self):
        for tag, attr in (('img', 'src'), ('a', 'href'), ('video', 'src'), ('audio', 'src'), ('source', 'src')):
            with self.subTest(tag=tag):
                self.assertTrue(validate_archive_resources(self.root, '2b4994.html', f'<{tag} {attr}="files/missing">', True))
                self.assertFalse(validate_archive_resources(self.root, '2b4994.html', f'<{tag} {attr}="files/foo.md">', True))

    def test_external_fragment_code_and_encoded_references(self):
        content = '[external](https://example.com/a) [anchor](#part) `![example](missing.png)`\n```md\n[example](missing)\n```\n[attachment](files/nested/a%20b.pdf)'
        self.assertEqual(validate_archive_resources(self.root, 'chat.md', content), [])

    def test_markdown_oracle_rejects_same_basename(self):
        from tests.helpers.export_spec_asserter import ExportSpecificationAsserter
        oracle = ExportSpecificationAsserter(str(self.root))
        oracle.assert_multimedia_assets('[foo](assets/files/foo.md)', 'cb8bd7.md')
        self.assertEqual(len(oracle.errors), 1)
        oracle.errors.clear()
        oracle.assert_multimedia_assets('[foo](files/foo.md)', 'cb8bd7.md')
        self.assertEqual(oracle.errors, [])

    def test_math_function_application_is_not_an_attachment(self):
        # Real Tier2 STA response contains \left[...\right](\mathbf{t}) inside $$.
        for formula in (r'$$\left[W(k)\right](\mathbf{t})$$',
                        r'$\left[W(k)\right](\mathbf{t})$',
                        r'\[\left[W(k)\right](\mathbf{t})\]',
                        r'\(\left[W(k)\right](\mathbf{t})\)'):
            with self.subTest(formula=formula):
                self.assertEqual(validate_archive_resources(self.root, 'chat.md', formula), [])
                # Context exclusion must not hide a real broken attachment outside math.
                self.assertEqual(len(validate_archive_resources(
                    self.root, 'chat.md', formula + '\n[attachment](assets/files/foo.md)')), 1)

    def test_symlink_escape(self):
        (self.root / 'escape').symlink_to(self.root.parent)
        with self.assertRaises(ValueError):
            find_archive_resource(self.root, 'chat.html', 'escape/something')


if __name__ == '__main__':
    unittest.main()
