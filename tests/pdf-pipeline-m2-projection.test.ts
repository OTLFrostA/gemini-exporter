export {};
const test = require('node:test');
const assert = require('node:assert');
const { projectStage } = require('../src/core/export/pdf/pipeline/projectionStage.js');
function sampleBundle(): any {
    return { conversation: { messages: [{ id: 'second', role: 'assistant', blocks: [] }, { id: 'first', role: 'user', blocks: [] }] }, assets: [], citations: [] };
}
function makeCtx() {
    const controller = new AbortController();
    const logs: Array<{ message: string; level?: string }> = [];
    return {
        controller,
        signal: controller.signal,
        reportProgress: (_s: string, _c: number, _t: number) => {},
        log: (message: string, level?: 'info' | 'warn' | 'error') => { logs.push({ message, level }); },
        logs,
    };
}

test('project stage preserves the source array and ignores leaf transport', async () => {
    const bundle = sampleBundle();
    const ctx = makeCtx();
    const { output, diagnostics } = await projectStage({ bundle, leafMessageId: 'first' }, ctx);
    assert.strictEqual(output.bundle, bundle);
    assert.strictEqual(output.view.messages, bundle.conversation.messages);
    assert.deepStrictEqual(output.view.messages.map((m: any) => m.id), ['second', 'first']);
    assert.deepStrictEqual(diagnostics, []);
    assert.deepStrictEqual(ctx.logs, []);
});

test('aborted signal throws AbortError, never a quiet failure', async () => {
    const bundle = sampleBundle();
    const ctx = makeCtx();
    ctx.controller.abort();
    await assert.rejects(
        projectStage({ bundle }, ctx),
        (e: any) => e instanceof DOMException && e.name === 'AbortError',
    );
});
