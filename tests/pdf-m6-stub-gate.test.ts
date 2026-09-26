/**
 * tests/pdf-m6-stub-gate.test.ts
 *
 * Tier 1 tests for the D7 M6 production stub gate (carries #558's mechanical
 * defense into the D7 pipeline):
 *
 * - the production default compiler is the real Typst sandbox compiler;
 *   constructing PdfExporter without a compiler outside an extension page
 *   context throws instead of silently falling back to the stub;
 * - a StubPdfCompiler reaching run() without an explicit allowStub opt-in
 *   (constructor or per-run) throws BEFORE any export work — no placeholder
 *   PDF is produced and nothing is marked successful;
 * - the per-run allowStub opt-in still lets tests through.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { PdfExporter, StubPdfCompiler } = require('../src/core/export/pdf/index.js');

const fixtureDir = path.join(__dirname, 'fixtures', 'canonical');
const sample = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'gemini-normalizer-sample.json'), 'utf8'));

function makeFakeWriter() {
    const files: Array<{ name: string; bytes: Uint8Array }> = [];
    const writer = {
        files,
        async writeFile(relativePath: string, content: any) {
            const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(String(content));
            files.push({ name: relativePath, bytes });
            return relativePath;
        },
        async generateBlob() {
            return new Blob(files.map((f) => f.bytes as any), { type: 'application/zip' });
        },
    };
    return writer;
}

test('M6: bare construction outside an extension page throws instead of silently using the stub', () => {
    assert.throws(
        () => new PdfExporter(),
        /\[M6 stub gate\].*without a compiler/,
        'no silent stub fallback in node',
    );
});

test('M6: stub without allowStub throws the gate error before any export work', async () => {
    const writer = makeFakeWriter();
    const exporter = new PdfExporter(new StubPdfCompiler());
    await assert.rejects(
        exporter.run(
            {
                selected: [{ id: sample.id, title: sample.title }],
                conversations: [sample],
                useZip: false,
                writer,
            },
            { onLog: () => {} },
        ),
        /\[M6 stub gate\].*allowStub/,
    );
    assert.strictEqual(writer.files.length, 0, 'no file may be written when the gate fires');
});

test('M6: per-run options.compiler stub without allowStub is also gated', async () => {
    const writer = makeFakeWriter();
    const exporter = new PdfExporter(new StubPdfCompiler(), { allowStub: true });
    await assert.rejects(
        exporter.run(
            {
                selected: [{ id: sample.id, title: sample.title }],
                conversations: [sample],
                useZip: false,
                writer,
                compiler: new StubPdfCompiler(),
                allowStub: false,
            },
            { onLog: () => {} },
        ),
        /\[M6 stub gate\]/,
    );
    assert.strictEqual(writer.files.length, 0, 'no file may be written when the gate fires');
});

test('M6: per-run allowStub opt-in lets the stub through', async () => {
    const writer = makeFakeWriter();
    const exporter = new PdfExporter(new StubPdfCompiler());
    const result = await exporter.run(
        {
            selected: [{ id: sample.id, title: sample.title }],
            conversations: [sample],
            useZip: false,
            writer,
            allowStub: true,
        },
        { onLog: () => {} },
    );
    assert.strictEqual(result.succeeded, 1, 'opted-in stub export still succeeds');
    assert.strictEqual(writer.files.length, 1);
});
