export {};
const test = require('node:test');
const assert = require('node:assert');

const { renderTypstFixture } = require('./helpers/renderTypstFixture.js');
const { composeDomainDocument } = require('../src/core/export/document/composeDomainDocument.js');
const { TypstSandboxCompiler } = require('../src/core/export/typst/typstSandboxCompiler.js');
const { convertMath } = require('../src/core/export/typst/mathConverter.js');
const { extractPdfText } = require('./helpers/pdfTextExtract.js');
const {
    RealWasmSandboxHost,
    repoRoot,
} = require('./helpers/realWasmSandbox.js');

function domainFixture(messages: any[], assets: any[] = []) {
    return { providerId: 'gemini', id: 'c1', title: 'Fixture', timestamp: null, createdAt: '2026-09-26T10:00:00Z', assets, messages: messages };
}

function msg(id: string, role: string, blocks: any[], extra: any = {}) {
    return { id, role, content: blocks, ...extra };
}

const opts = {};

function cell(text: string) {
    return { children: [{ type: 'text', text }] };
}

function row(...texts: string[]) {
    return { cells: texts.map(cell) };
}

test('multi header rows all reach the transport with no collapse diagnostic', async () => {
    const b = domainFixture([msg('m1', 'assistant', [{
        type: 'table', headerRows: [row('h1a', 'h1b'), row('h2a', 'h2b')],
        rows: [row('b1a', 'b1b')],
    }])]);
    const { payload, diagnostics } = renderTypstFixture(composeDomainDocument(b).document, Object.fromEntries(b.assets.map((asset: { id: string }) => [asset.id, `assets/${asset.id}.png`])), opts);
    const node: any = payload.messages[0].blocks[0];
    assert.strictEqual(node.type, 'table');
    assert.strictEqual(node.headers.length, 2);
    assert.strictEqual(node.headers[0].length, 2);
    assert.strictEqual(node.headers[0][0].children[0].text, 'h1a');
    assert.strictEqual(node.headers[1][1].children[0].text, 'h2b');
    assert.strictEqual(node.rows[0][0].children[0].text, 'b1a');
    assert.ok(!diagnostics.some((d: any) => d.code === 'TYPST_V8_MULTI_HEADER_COLLAPSE'));
});

test('colSpan/rowSpan map to native Typst table.cell spans with no warning', async () => {
    const spanned = { children: [{ type: 'text', text: 'wide' }], colSpan: 2 };
    const tall = { children: [{ type: 'text', text: 'tall' }], rowSpan: 2 };
    const b = domainFixture([msg('m1', 'assistant', [{
        type: 'table', rows: [{ cells: [spanned, { children: [{ type: 'text', text: 'b' }] }] }, { cells: [tall, { children: [{ type: 'text', text: 'c' }] }] }],
    }])]);
    const { payload, diagnostics } = renderTypstFixture(composeDomainDocument(b).document, Object.fromEntries(b.assets.map((asset: { id: string }) => [asset.id, `assets/${asset.id}.png`])), opts);
    const node: any = payload.messages[0].blocks[0];
    assert.strictEqual(node.rows[0].length, 2);
    assert.strictEqual(node.rows[0][0].colspan, 2);
    assert.strictEqual(node.rows[0][0].children[0].text, 'wide');
    assert.ok(!('colspan' in node.rows[0][1]), 'span of 1 is not emitted');
    assert.strictEqual(node.rows[1][0].rowspan, 2);
    assert.ok(!diagnostics.some((d: any) => d.code === 'TYPST_V8_TABLE_SPAN_IGNORED'));
});

test('message sources append a note to blocks in Typst payload', async () => {
    const b = domainFixture(
        [msg('m1', 'assistant', [], { citations: [{ id: 'c1', url: 'https://example.com/a' }] })],
    );
    const { payload } = renderTypstFixture(composeDomainDocument(b).document, Object.fromEntries(b.assets.map((asset: { id: string }) => [asset.id, `assets/${asset.id}.png`])), opts);
    const node: any = payload.messages[0].blocks[0];
    assert.strictEqual(node.type, 'note');
    assert.ok(!('label' in node));
    assert.ok((node.children[0].text as string).includes('[1]'));
});

test('file description reaches the transport', async () => {
    const b = domainFixture(
        [msg('m1', 'assistant', [{
            type: 'file', assetId: 'fa',
            label: 'report.pdf',
            description: [{ type: 'text', text: 'Q3 summary deck' }],
        }])],
        [{ id: 'fa', name: 'report.pdf', kind: 'file', mediaType: 'application/pdf', byteLength: 2048 }],
    );
    const { payload } = renderTypstFixture(composeDomainDocument(b).document, Object.fromEntries(b.assets.map((asset: { id: string }) => [asset.id, `assets/${asset.id}.png`])), opts);
    const node: any = payload.messages[0].blocks[0];
    assert.strictEqual(node.type, 'file');
    assert.deepStrictEqual(node.description, [{ type: 'text', text: 'Q3 summary deck' }]);
});

test('thought kinds map to note labels', async () => {
    const cases: Array<[string, string | undefined]> = [
        ['summary', 'Thinking Summary'],
        ['progress', 'Thinking Progress'],
        ['reasoning', 'Thinking Process'],
        ['unknown', undefined],
    ];
    for (const [kind, label] of cases) {
        const b = domainFixture([msg('m1', 'assistant', [{
            type: 'thought', disclosure: 'providerExposed', kind,
            blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'hmm' }] }],
        }])]);
        const { payload } = renderTypstFixture(composeDomainDocument(b).document, Object.fromEntries(b.assets.map((asset: { id: string }) => [asset.id, `assets/${asset.id}.png`])), opts);
        const node: any = payload.messages[0].blocks[0];
        assert.strictEqual(node.type, 'note');
        assert.strictEqual(node.label, label, `kind=${kind}`);
    }
});

test('code filename and meta reach the transport', async () => {
    const b = domainFixture([msg('m1', 'assistant', [{
        type: 'code', code: 'print(1)', language: 'python',
        filename: 'app.py', meta: 'runnable',
    }])]);
    const { payload } = renderTypstFixture(composeDomainDocument(b).document, Object.fromEntries(b.assets.map((asset: { id: string }) => [asset.id, `assets/${asset.id}.png`])), opts);
    const node: any = payload.messages[0].blocks[0];
    assert.strictEqual(node.type, 'code');
    assert.strictEqual(node.header, 'app.py · python · runnable');
    assert.ok(!('filename' in node));
    assert.ok(!('meta' in node));
});

test('code without filename has no filename field', async () => {
    const b = domainFixture([msg('m1', 'assistant', [
        { type: 'code', code: 'x', language: 'text' },
    ])]);
    const { payload } = renderTypstFixture(composeDomainDocument(b).document, Object.fromEntries(b.assets.map((asset: { id: string }) => [asset.id, `assets/${asset.id}.png`])), opts);
    const node: any = payload.messages[0].blocks[0];
    assert.ok(!('filename' in node));
    assert.ok(!('meta' in node));
});

async function compileOnce(domain: any) {
    const host = new RealWasmSandboxHost(repoRoot());
    const compiler = new TypstSandboxCompiler({ host });
    const resources = Object.fromEntries(domain.assets.map((asset: { id: string }) => [asset.id, `/assets/${asset.id}.png`]));
    const { payload: document } = renderTypstFixture(composeDomainDocument(domain).document, resources, { convertMath });
    const context = {

        assets: {
            resolve: async (id: string) => null,
        },
        locale: 'en' as const,
        signal: new AbortController().signal,
        reportProgress: () => undefined,
    };
    try {
        const result = await compiler.compile(
            {
                rendererSchemaVersion: 1,

                document,
                assetPaths: new Map(Object.entries(resources)),
            } as never,
            context as never,
        );
        return result;
    } finally {
        compiler.dispose();
    }
}

test('real WASM: phase B features compile with all text selectable', async () => {
    const b = domainFixture(
        [msg('m1', 'assistant', [
            {
                type: 'table', headerRows: [row('hdr-one', 'hdr-two'), row('sub-one', 'sub-two')],
                rows: [row('cell-one', 'cell-two')],
            },
            {
                type: 'file', assetId: 'fa',
                label: 'report.pdf',
                description: [{ type: 'text', text: 'Q3 summary deck' }],
            },
            { type: 'heading', level: 4, children: [{ type: 'text', text: 'fourth level' }] },
            { type: 'heading', level: 5, children: [{ type: 'text', text: 'fifth level' }] },
            { type: 'heading', level: 6, children: [{ type: 'text', text: 'sixth level' }] },
            {
                type: 'thought', disclosure: 'providerExposed', kind: 'progress',
                blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'working on it' }] }],
            },
            {
                type: 'code', code: 'print(1)', language: 'python',
                filename: 'app.py', meta: 'runnable',
            },
        ], { citations: [{ id: 'c1', url: 'https://example.com/a', title: 'Key sources' }] })],
        [{ id: 'fa', name: 'report.pdf', kind: 'file', mediaType: 'application/pdf', byteLength: 2048 }],
    );
    const result = await compileOnce(b);
    assert.ok(result.pdfBytes && result.pdfBytes.length > 0, 'compile must produce PDF bytes');
    const extracted = extractPdfText(result.pdfBytes);
    for (const needle of [
        'hdr-one', 'hdr-two', 'sub-one', 'sub-two', 'cell-one', 'cell-two',
        'Key sources', 'report.pdf', 'Q3 summary deck',
        'fourth level', 'fifth level', 'sixth level',
        'Thinking Progress', 'working on it',
        'app.py', 'runnable',
    ]) {
        assert.ok(extracted.text.includes(needle), `missing from PDF text: ${needle}`);
    }
});
