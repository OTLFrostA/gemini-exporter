// tests/arch/no_stub_pdf_in_production.test.ts
// Architectural gate (D7 M6, carries #558's mechanical defense into the D7
// pipeline): the test stub compiler must never be constructible from
// production src, and the stub gate in pdfExporter.ts must stay wired.
//
// Rules (non-test src only):
//  (a) `new StubPdfCompiler(` appears ONLY in src/core/export/pdf/pdfCompiler.ts
//      (the definition itself). No production module may instantiate it.
//  (b) the `STUB_COMPILER_PLACEHOLDER` diagnostic code appears ONLY in
//      pdfCompiler.ts — placeholder PDFs must never be produced elsewhere.
//  (c) pdfExporter.ts keeps the M6 stub gate: it must reference the stub
//      name constant and the allowStub opt-in.
export {};
const test = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STUB_DEFINITION_FILE = 'src/core/export/pdf/pdfCompiler.ts';
const EXPORTER_FILE = 'src/core/export/pdf/pdfExporter.ts';

function gitGrepFixed(pattern: string): Array<{ file: string; line: number; text: string }> {
    let out = '';
    try {
        out = execSync(`git -C "${REPO_ROOT}" grep -n -F -- "${pattern}" -- "*.ts"`, { encoding: 'utf8' });
    } catch (e: any) {
        if (e && e.status === 1) return [];
        throw e;
    }
    return out
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l: string) => {
            const m = l.match(/^([^:]+):(\d+):(.*)$/);
            return { file: m![1], line: Number(m![2]), text: m![3] };
        })
        .filter((h) => !h.file.startsWith('tests/'));
}

function isRealCode(text: string, pattern: string): boolean {
    return text.replace(/\/\/.*$/, '').includes(pattern);
}

test('arch: new StubPdfCompiler( only in its own definition file', () => {
    const hits = gitGrepFixed('new StubPdfCompiler(').filter((h) => isRealCode(h.text, 'new StubPdfCompiler('));
    const outside = hits.filter((h) => h.file !== STUB_DEFINITION_FILE);
    assert.strictEqual(
        outside.length,
        0,
        `StubPdfCompiler must never be instantiated from production src; it is test-only:\n` +
            outside.map((h) => `  ${h.file}:${h.line}: ${h.text.trim()}`).join('\n'),
    );
});

test('arch: STUB_COMPILER_PLACEHOLDER only in pdfCompiler.ts', () => {
    const hits = gitGrepFixed('STUB_COMPILER_PLACEHOLDER').filter((h) =>
        isRealCode(h.text, 'STUB_COMPILER_PLACEHOLDER'),
    );
    const outside = hits.filter((h) => h.file !== STUB_DEFINITION_FILE);
    assert.strictEqual(
        outside.length,
        0,
        `placeholder-PDF diagnostics must only originate in ${STUB_DEFINITION_FILE}:\n` +
            outside.map((h) => `  ${h.file}:${h.line}: ${h.text.trim()}`).join('\n'),
    );
});

test('arch: pdfExporter.ts keeps the M6 stub gate wired', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, EXPORTER_FILE), 'utf8');
    assert.ok(
        src.includes('STUB_PDF_COMPILER_NAME'),
        'pdfExporter.ts must match the stub by its exported name constant',
    );
    assert.ok(src.includes('allowStub'), 'pdfExporter.ts must keep the allowStub opt-in');
    assert.ok(
        src.includes('[M6 stub gate]'),
        'pdfExporter.ts must keep the fail-fast stub gate error',
    );
});
