/**
 * tests/real_corpus.test.ts
 *
 * Tier 1 unit test for Real Gemini Corpus extraction & execution (Section 6, 23 & Remediation Plan 1.1).
 * Verifies:
 * 1. Corpus is strictly segmented into real_gemini_output, scenario_inputs, and synthetic_fixtures.
 * 2. ONLY real_gemini_output may justify compatibility rules.
 * 3. Injectable parser architecture allows candidate injection and differential comparison.
 * 4. Genuine Typst WASM compilation gate calculates compileFailures without error.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { runCorpus } = require('../scripts/parser_migration/run_corpus.ts');

const CORPUS_PATH = path.join(__dirname, 'fixtures/real_gemini_corpus.json');
const REPORT_PATH = path.join(__dirname, 'output/corpus_report.json');

test('Real Gemini Corpus: Segmentation & admission policy assertions', () => {
    assert.ok(fs.existsSync(CORPUS_PATH), 'real_gemini_corpus.json must exist');
    const data = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf-8'));

    assert.ok(data.corpusSets, 'Corpus must declare corpusSets');
    assert.ok(data.corpusSets.real_gemini_output, 'Corpus must declare real_gemini_output');
    assert.ok(data.corpusSets.scenario_inputs, 'Corpus must declare scenario_inputs');
    assert.ok(data.corpusSets.synthetic_fixtures, 'Corpus must declare synthetic_fixtures');

    // Strict Rule: ONLY real_gemini_output may justify compatibility rules
    assert.ok(data.admissionPolicy?.real_gemini_output?.includes('ONLY'), 'Admission policy must restrict compat rules to real_gemini_output');

    // Scenario inputs & synthetic sets must have documents
    assert.ok(data.corpusSets.scenario_inputs.documents.length >= 100, 'Expected >= 100 scenario input docs');
    assert.ok(data.corpusSets.scenario_inputs.mathExpressions.length >= 50, 'Expected >= 50 scenario input math');
});

test('Real Gemini Corpus: Injectable runner executes with real Typst compilation gate', async () => {
    // 1. Run with genuine Typst WASM compilation gate enabled
    const report = await runCorpus({
        corpusPath: CORPUS_PATH,
        outputPath: REPORT_PATH,
        compileTypst: true,
    });

    assert.strictEqual(report.markdown.documents >= 100, true);
    assert.strictEqual(report.markdown.parseFailures, 0, 'Markdown parsing must produce zero crashes');
    assert.strictEqual(report.math.expressions >= 50, true);
    assert.strictEqual(report.math.compileFailures, 0, 'Converted expressions must compile cleanly in Typst WASM');

    assert.ok(fs.existsSync(REPORT_PATH), 'Corpus report must be saved on disk');
    const diskReport = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf-8'));
    assert.strictEqual(diskReport.markdown.documents, report.markdown.documents);
    assert.strictEqual(diskReport.markdown.parseFailures, 0);

    // 2. Test candidate parser injection capability
    let candidateCalled = false;
    const diffReport = await runCorpus({
        corpusPath: CORPUS_PATH,
        corpusCategory: 'synthetic_fixtures',
        candidateParser: async (content: string, id: string) => {
            candidateCalled = true;
            return {
                bundle: { conversation: { messages: [{ blocks: [{ type: 'paragraph', children: [{ type: 'text', text: content }] }] }] } },
                diagnostics: [],
            };
        },
    });

    assert.strictEqual(candidateCalled, true, 'Candidate parser must be invoked when provided');
    assert.ok(diffReport.markdown.documents > 0);
});
