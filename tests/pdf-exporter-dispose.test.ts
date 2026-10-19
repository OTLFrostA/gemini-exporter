import { acquiredReply } from './helpers/acquisitionFixture.js';
import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { indexFixture } from './helpers/indexFixture.js';
const { historicalFixture } = require('./helpers/nativeFixture.js');
/**
 * tests/pdf-exporter-dispose.test.ts
 *
 * Tier 1 tests for the #592 P1 fix: the production-owned Typst sandbox
 * compiler must be disposed at run end, and an injected/shared compiler
 * must never be disposed by the exporter.
 *
 * Background: every production export built a fresh TypstSandboxCompiler
 * (hidden iframe + window message listener capturing `this` + WASM state +
 * cached font bytes), but nothing ever called its dispose() — exportController
 * only nulled the reference and PdfExporter.abort() only aborts. One export
 * leaked one sandbox; repeated exports accumulated them.
 *
 * Ownership rule under test:
 * - `new PdfExporter()` (no compiler) owns its compiler -> dispose() must
 *   tear it down. The production controller calls dispose() in its
 *   run-finally on every path (success / failure / abort).
 * - `new PdfExporter(injected)` never owns it -> dispose() must not touch
 *   the caller's compiler. Same for a per-run `options.compiler`.
 * - abort() is cancel-only and never disposes.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { PdfExporter } = require('../src/core/export/pdf/index.js');
const ExportController = require('../src/ui/controllers/exportController.js');
const { buildMinimalValidPdf } = require('./helpers/stubPdfCompiler.js');
const { TypstSandboxCompiler } = require('../src/core/export/typst/typstSandboxCompiler.js');

const fixtureDir = path.join(__dirname, 'fixtures', 'provider');
const sample = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'conversation-sample.json'), 'utf8'));

/** Fake an extension page context so `new PdfExporter()` builds the real default compiler. */
function fakeExtensionPageContext() {
    const g = globalThis as any;
    const priorDocument = Object.getOwnPropertyDescriptor(g, 'document');
    const priorChrome = Object.getOwnPropertyDescriptor(g, 'chrome');
    Object.defineProperty(g, 'document', {
        value: { getElementById: () => null }, configurable: true, writable: true,
    });
    Object.defineProperty(g, 'chrome', {
        value: { ...g.chrome, runtime: { ...g.chrome.runtime, getURL: (p: string) => `chrome-extension://fake/${p}` } },
        configurable: true, writable: true,
    });
    return () => {
        if (priorDocument) Object.defineProperty(g, 'document', priorDocument);
        else Reflect.deleteProperty(g, 'document');
        if (priorChrome) Object.defineProperty(g, 'chrome', priorChrome);
        else Reflect.deleteProperty(g, 'chrome');
    };
}

/** Spy on TypstSandboxCompiler.prototype.dispose; restores on cleanup. */
function spyOnSandboxDispose() {
    const proto = TypstSandboxCompiler.prototype;
    const original = proto.dispose;
    let calls = 0;
    proto.dispose = function (this: any, ...args: any[]) {
        calls += 1;
        return original.apply(this, args);
    };
    return {
        get calls() {
            return calls;
        },
        restore() {
            proto.dispose = original;
        },
    };
}

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

/** A per-run injected compiler the exporter must never dispose. */
function makeFakeCompiler(opts: { throws?: boolean } = {}) {
    const calls = { dispose: 0, compile: 0 };
    return {
        calls,
        name: 'fake-test-compiler',
        async compile() {
            calls.compile += 1;
            if (opts.throws) throw new Error('fake compile boom');
            return { pdfBytes: buildMinimalValidPdf(), diagnostics: [] };
        },
        dispose() {
            calls.dispose += 1;
        },
    };
}

function baseOptions(writer: any, extra: any = {}) {
    return {
        accountId: '10000000-0000-4000-8000-000000000001',
        selected: [{ id: sample.id, title: sample.title }],
        conversations: ([sample]).map(indexFixture), fetchChatDetail: async (item: { id: string }) => await acquiredReply(({ success: true, results: [historicalFixture(([sample]).find((row: { id: string }) => row.id.replace(/^c_/, '') === item.id.replace(/^c_/, '')) || {})] })),
        useZip: false,
        writer,
        ...extra,
    };
}


test('dispose: production-owned compiler (constructor default) is disposed', () => {
    const restoreCtx = fakeExtensionPageContext();
    const spy = spyOnSandboxDispose();
    try {
        const exporter = new PdfExporter();
        exporter.dispose();
        assert.strictEqual(spy.calls, 1, 'the owned TypstSandboxCompiler must be disposed');
    } finally {
        spy.restore();
        restoreCtx();
    }
});

test('dispose: an injected/shared compiler is never disposed', async () => {
    const fake = makeFakeCompiler();
    const writer = makeFakeWriter();
    const exporter = new PdfExporter(fake as any);
    const result = await exporter.run(baseOptions(writer), { onLog: () => {} });
    exporter.dispose();
    assert.strictEqual(result.succeeded, 1);
    assert.strictEqual(fake.calls.compile, 1);
    assert.strictEqual(fake.calls.dispose, 0, 'a caller-owned compiler must survive exporter disposal');
});

test('dispose: owned compiler disposed after a successful run; per-run injected compiler untouched', async () => {
    const restoreCtx = fakeExtensionPageContext();
    const spy = spyOnSandboxDispose();
    try {
        const fake = makeFakeCompiler();
        const writer = makeFakeWriter();
        const result = await ExportController.runExport(
            { ...baseOptions(writer, { compiler: fake }), format: 'pdf' }, { onLog: () => {} },
        );
        assert.strictEqual(result.succeeded, 1, 'real UI controller must complete the PDF export');
        assert.strictEqual(fake.calls.compile, 1, 'injected compiler must do the actual work');
        assert.strictEqual(spy.calls, 1, 'real controller must dispose its production-owned compiler');
        assert.strictEqual(fake.calls.dispose, 0, 'per-run injected compiler belongs to the caller');
        assert.strictEqual(ExportController.isRunning(), false);
        assert.strictEqual(ExportController.getActiveEngine(), null);
    } finally {
        spy.restore();
        restoreCtx();
    }
});

test('dispose: owned compiler disposed after a failed run; per-run injected compiler untouched', async () => {
    const restoreCtx = fakeExtensionPageContext();
    const spy = spyOnSandboxDispose();
    try {
        const fake = makeFakeCompiler({ throws: true });
        const writer = makeFakeWriter();
        const result = await ExportController.runExport(
            { ...baseOptions(writer, { compiler: fake }), format: 'pdf' }, { onLog: () => {} },
        );
        assert.strictEqual(result.succeeded, 0);
        assert.strictEqual(result.failed.length, 1, 'the throwing compile must surface as a failed item');
        assert.strictEqual(fake.calls.compile, 1);
        assert.strictEqual(spy.calls, 1, 'controller must dispose even when the PDF item fails');
        assert.strictEqual(fake.calls.dispose, 0, 'caller-supplied compiler must survive item failure');
        assert.strictEqual(ExportController.isRunning(), false);
        assert.strictEqual(ExportController.getActiveEngine(), null);
    } finally {
        spy.restore();
        restoreCtx();
    }
});

test('dispose: controller finally also cleans up when exporter.run itself throws', async () => {
    const restoreCtx = fakeExtensionPageContext();
    const spy = spyOnSandboxDispose();
    const originalRun = PdfExporter.prototype.run;
    try {
        PdfExporter.prototype.run = async () => { throw new Error('unexpected export failure'); };
        await assert.rejects(
            ExportController.runExport({ format: 'pdf', selected: [] }, {}),
            /unexpected export failure/,
        );
        assert.strictEqual(spy.calls, 1, 'controller finally must run on a rejected export');
        assert.strictEqual(ExportController.isRunning(), false);
        assert.strictEqual(ExportController.getActiveEngine(), null);
    } finally {
        PdfExporter.prototype.run = originalRun;
        spy.restore();
        restoreCtx();
    }
});

test('dispose: abort() is cancel-only and never disposes', () => {
    const restoreCtx = fakeExtensionPageContext();
    const spy = spyOnSandboxDispose();
    try {
        const exporter = new PdfExporter();
        exporter.abort();
        assert.strictEqual(exporter.aborted, true);
        assert.strictEqual(spy.calls, 0, 'abort must not dispose; disposal happens at run end');
        exporter.dispose();
        assert.strictEqual(spy.calls, 1);
    } finally {
        spy.restore();
        restoreCtx();
    }
});

test('dispose: idempotent, safe to call twice', () => {
    const restoreCtx = fakeExtensionPageContext();
    try {
        const exporter = new PdfExporter();
        assert.doesNotThrow(() => exporter.dispose());
        assert.doesNotThrow(() => exporter.dispose(), 'repeat disposal must stay safe');
    } finally {
        restoreCtx();
    }
});
