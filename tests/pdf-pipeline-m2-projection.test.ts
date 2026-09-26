/**
 * tests/pdf-pipeline-m2-projection.test.ts
 * Tier 1 focused test for the D7 S1 projection stage (M2).
 *
 * Locks the stage behavior with a fake branching bundle:
 * - an explicit leaf override projects only the chosen root->leaf path;
 * - without an override the bundle's selectedLeafMessageId is used;
 * - the omitted branch count is recorded as one info log;
 * - an invalid tree becomes a non-retryable StageError('project', ...);
 * - an aborted signal throws AbortError (never a quiet failure).
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const { projectStage } = require('../src/core/export/pdf/pipeline/projectionStage.js');
const { StageError } = require('../src/core/export/pdf/pipeline/types.js');

function msg(id: string, role: string, parentId: string | null): any {
    return { id, role, parentId, blocks: [] };
}

function branchingBundle(): any {
    return {
        conversation: {
            key: { providerId: 'gemini', accountId: 't', conversationId: 'c1' },
            title: { value: 'T', source: 'default', candidates: [] },
            messages: [
                msg('u1', 'user', null),
                msg('a1', 'assistant', 'u1'),
                msg('u2a', 'user', 'a1'),
                msg('a2a', 'assistant', 'u2a'),
                msg('u2b', 'user', 'a1'),
                msg('a2b', 'assistant', 'u2b'),
            ],
            selectedLeafMessageId: 'a2a',
        },
        assets: [],
        citations: [],
    };
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

test('explicit leaf override projects only the chosen path', async () => {
    const bundle = branchingBundle();
    const ctx = makeCtx();
    const { output, diagnostics } = await projectStage({ bundle, leafMessageId: 'a2b' }, ctx);
    assert.deepStrictEqual(output.view.messages.map((m: any) => m.id), ['u1', 'a1', 'u2b', 'a2b']);
    assert.deepStrictEqual(output.view.selectedPathIds, ['u1', 'a1', 'u2b', 'a2b']);
    assert.deepStrictEqual(output.view.omittedBranchMessageIds.sort(), ['a2a', 'u2a']);
    assert.deepStrictEqual(diagnostics, []);
    // the omitted branch count is recorded as one info log
    const infos = ctx.logs.filter((l: any) => l.level === 'info');
    assert.strictEqual(infos.length, 1);
    assert.ok(infos[0].message.includes('2'), `info log should carry the omitted count, got: ${infos[0].message}`);
});

test('no override falls back to the bundle selected leaf', async () => {
    const bundle = branchingBundle();
    const ctx = makeCtx();
    const { output } = await projectStage({ bundle }, ctx);
    assert.deepStrictEqual(output.view.messages.map((m: any) => m.id), ['u1', 'a1', 'u2a', 'a2a']);
    assert.strictEqual(output.bundle, bundle, 'the bundle passes through untouched');
});

test('invalid tree becomes a non-retryable StageError on the project stage', async () => {
    const bundle = branchingBundle();
    bundle.conversation.messages.push(msg('u1', 'user', null)); // duplicate id
    const ctx = makeCtx();
    await assert.rejects(
        projectStage({ bundle }, ctx),
        (e: any) =>
            e instanceof StageError &&
            e.stage === 'project' &&
            e.code === 'MSG_DUP_ID' &&
            e.retryable === false,
    );
});

test('aborted signal throws AbortError, never a quiet failure', async () => {
    const bundle = branchingBundle();
    const ctx = makeCtx();
    ctx.controller.abort();
    await assert.rejects(
        projectStage({ bundle }, ctx),
        (e: any) => e instanceof DOMException && e.name === 'AbortError',
    );
});
