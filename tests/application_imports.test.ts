import { account, chatgptAccount, reset, state } from './helpers/applicationHarness.js';
import { OperationError } from '../src/shared/errors/operationError.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { importTakeout } from '../src/application/imports/importTakeout.js';
import { importOpenAI } from '../src/application/imports/importOpenAI.js';
import { createSourceResourceContext } from '../src/application/resources.js';

test.beforeEach(reset);

const dummyFile = () => ({ size: 16 } as unknown as File);

test('Application Takeout import admits parsed conversations to L2, notifies Runtime, and retains lazy archive readers only on acceptance', async () => {
    let entryReads = 0;
    state.takeoutParsed = [{
        conversationId: 'takeout-1',
        conversation: {
            index: { title: 'Offline title', titleSource: 'derived' },
            detail: {
                quality: { status: 'complete' },
                messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hi' }] }] }],
                assets: [{ id: 'img-1', kind: 'image', mediaType: 'image/png' }],
            },
        },
        diagnostics: [],
        acquisitionHints: {},
        archiveResources: {
            'img-1': {
                entry: { async: async () => { entryReads++; return Uint8Array.of(9, 8, 7); } },
                path: 'Takeout/Gemini/picture.png',
            },
        },
    }];
    const progress: number[] = [];
    const resources = createSourceResourceContext();
    state.detailDecision = { accepted: true, changed: true, indexAdded: true };
    const result = await importTakeout(dummyFile(), account.id, p => progress.push(p), resources);
    assert.deepEqual(result, { imported: 1, added: 1, status: 'ok' });
    assert.equal(state.admittedDetails.length, 1);
    assert.equal(state.admittedDetails[0].accountId, account.id);
    assert.equal(state.admittedDetails[0].conversationId, 'takeout-1');
    assert.deepEqual(state.notifications, [account.id]);
    assert.equal(progress.at(-1), 100);
    assert.equal(entryReads, 0);
    const key = { accountId: account.id, conversationId: 'takeout-1' };
    assert.deepEqual((await resources.acquire(key, { id: 'img-1', kind: 'image' })).bytes, Uint8Array.of(9, 8, 7));
    assert.equal(entryReads, 1);

    // Rejected L2 detail does not retain readers
    reset();
    state.takeoutParsed = [{
        conversationId: 'takeout-2',
        conversation: {
            index: {},
            detail: { quality: { status: 'complete' }, messages: [{ role: 'user', content: [] }], assets: [{ id: 'img-2', kind: 'image' }] },
        },
        diagnostics: [],
        acquisitionHints: {},
        archiveResources: { 'img-2': { entry: { async: async () => Uint8Array.of(1) }, path: 'a.png' } },
    }];
    state.detailDecision = { accepted: false, changed: false };
    const rejectedResources = createSourceResourceContext();
    const rejected = await importTakeout(dummyFile(), account.id, undefined, rejectedResources);
    assert.equal(rejected.added, 0, 'a rejected detail cannot count as a new local conversation');
    assert.equal(rejectedResources.has({ accountId: account.id, conversationId: 'takeout-2' }, 'img-2'), false);
});

test('Application Takeout import rejects foreign providers with GEMINI_ACCOUNT_REQUIRED and propagates L2 errors', async () => {
    await assert.rejects(
        importTakeout(dummyFile(), chatgptAccount.id),
        (err: unknown) => err instanceof OperationError && err.code === 'GEMINI_ACCOUNT_REQUIRED',
    );
    assert.equal(state.admittedDetails.length, 0);

    state.takeoutParsed = [{
        conversationId: 'takeout-err',
        conversation: { index: {}, detail: { quality: { status: 'complete' }, messages: [{ role: 'user', content: [] }], assets: [] } },
        diagnostics: [],
        acquisitionHints: {},
        archiveResources: {},
    }];
    state.detailError = new Error('L2 commit failed');
    await assert.rejects(importTakeout(dummyFile(), account.id), /L2 commit failed/);
});

test('Application OpenAI import orchestrates L1 archive parsing, L2 admission, lazy resource retention and empty/partial status', async () => {
    await assert.rejects(
        importOpenAI(new Uint8Array([1]), account.id),
        (err: unknown) => err instanceof OperationError && err.code === 'CHATGPT_ACCOUNT_REQUIRED',
    );

    state.openaiParsed = { conversationCount: 0, conversations: [], skippedEmpty: 0, missingAssets: 0 };
    assert.equal((await importOpenAI(new Uint8Array([1]), chatgptAccount.id)).status, 'empty');
    state.notifications.length = 0;

    const assetEntry = {
        path: 'file-1.dat',
        size: 3,
        text: async () => 'abc',
        bytes: async () => Uint8Array.of(1, 2, 3),
    };
    state.openaiParsed = {
        conversationCount: 1,
        skippedEmpty: 0,
        missingAssets: 0,
        conversations: [{
            conversationId: 'gpt-1',
            parsed: {
                conversationId: 'gpt-1',
                conversation: {
                    index: { title: 'GPT Chat', titleSource: 'provider', updatedAt: 1000 },
                    detail: {
                        quality: { status: 'complete' },
                        messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hello' }] }] }],
                        assets: [{ id: 'asset-1', kind: 'file', name: 'doc.txt' }],
                    },
                },
                diagnostics: [],
                acquisitionHints: {},
            },
            boundEntries: new Map([['asset-1', assetEntry]]),
            missingAssets: 0,
        }],
    };
    const resources = createSourceResourceContext();
    const progress: number[] = [];
    state.detailDecision = { accepted: true, changed: true, indexAdded: true };
    const okResult = await importOpenAI(new Uint8Array([1]), chatgptAccount.id, p => progress.push(p), resources);
    assert.deepEqual(okResult, { read: 1, imported: 1, added: 1, skipped: 0, missingAssets: 0, status: 'ok' });
    assert.equal(progress.at(-1), 100);
    assert.deepEqual(state.notifications, [chatgptAccount.id]);
    assert.ok(resources.has({ accountId: chatgptAccount.id, conversationId: 'gpt-1' }, 'asset-1'));

    // Rejected detail increments skipped and marks partial
    state.detailDecision = { accepted: false, changed: false };
    const skippedResult = await importOpenAI(new Uint8Array([1]), chatgptAccount.id);
    assert.deepEqual(skippedResult, { read: 1, imported: 0, added: 0, skipped: 1, missingAssets: 0, status: 'partial' });
});
