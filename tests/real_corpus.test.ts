/**
 * tests/real_corpus.test.ts
 *
 * Tier 1 unit test for Real Gemini Corpus extraction & execution (Section 6 & 23).
 * Verifies:
 * 1. Public real Gemini corpus exists, is properly formed, and contains >= 100 docs & >= 50 formulas.
 * 2. Running the corpus produces zero fatal parser crashes.
 * 3. Machine-readable report is saved to tests/output/corpus_report.json.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { runCorpus } = require('../scripts/parser_migration/run_corpus.ts');

const CORPUS_PATH = path.join(__dirname, 'fixtures/real_gemini_corpus.json');
const REPORT_PATH = path.join(__dirname, 'output/corpus_report.json');

test('Real Gemini Corpus: Fixture validity & volume assertions', () => {
    assert.ok(fs.existsSync(CORPUS_PATH), 'real_gemini_corpus.json must exist');
    const data = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf-8'));

    assert.ok(Array.isArray(data.documents), 'Corpus must declare documents array');
    assert.ok(data.documents.length >= 100, `Expected at least 100 documents, got ${data.documents.length}`);

    assert.ok(Array.isArray(data.mathExpressions), 'Corpus must declare mathExpressions array');
    assert.ok(data.mathExpressions.length >= 50, `Expected at least 50 math expressions, got ${data.mathExpressions.length}`);

    for (const doc of data.documents) {
        assert.ok(doc.id, 'Document must have id');
        assert.ok(doc.source, 'Document must have source');
        assert.ok(typeof doc.text === 'string' && doc.text.length > 0, 'Document must have non-empty text');
    }
});

test('Real Gemini Corpus: Runner executes with zero parse crashes and writes report', async () => {
    const report = await runCorpus(CORPUS_PATH, REPORT_PATH);

    assert.strictEqual(report.markdown.documents >= 100, true);
    assert.strictEqual(report.markdown.parseFailures, 0, 'Markdown parsing must produce zero crashes');
    assert.strictEqual(report.math.expressions >= 50, true);

    assert.ok(fs.existsSync(REPORT_PATH), 'Corpus report must be saved on disk');
    const diskReport = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf-8'));
    assert.strictEqual(diskReport.markdown.documents, report.markdown.documents);
    assert.strictEqual(diskReport.markdown.parseFailures, 0);
});
