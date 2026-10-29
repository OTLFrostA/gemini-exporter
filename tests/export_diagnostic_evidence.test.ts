import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatGPTProvider } from '../src/l1/client/chatgpt/chatgptProvider.js';
import { acquireSourceResource } from '../src/l1/resources/sourceResources.js';
import type { Diagnostic } from '../src/shared/diagnostics/diagnostic.js';
import { getOrCreateAccount } from '../src/runtime/api/accountRegistry.js';
import { useIndexStorage } from './helpers/indexStorage.js';
import { sessionGen } from './fixtures/providers/chatgptSession.js';
import { fileDownloadGen } from './fixtures/providers/chatgptFileDownload.js';
import { detailGen } from './fixtures/providers/chatgptDetail.js';

useIndexStorage();

for (const failure of ['locator', 'payload', 'signed', 'body'] as const) {
    test(`ChatGPT acquisition diagnostics identify ${failure} failure without signed URL disclosure`, async () => {
        const account = await getOrCreateAccount('chatgpt', 'default');
        const diagnostics: Diagnostic[] = [];
        const provider = new ChatGPTProvider({ fetchFn: async url => {
            if (url.endsWith('/api/auth/session')) return Response.json(sessionGen('C_FILE_DOWNLOAD_SESSION_01'));
            if (url.includes('/backend-api/')) {
                if (failure === 'locator') throw new TypeError('Failed to fetch');
                return Response.json(fileDownloadGen(failure === 'payload'
                    ? 'C_FILE_DOWNLOAD_ACQUIRE_02' : 'C_DIAGNOSTIC_SIGNED_DOWNLOAD_01'));
            }
            if (failure === 'signed') throw new TypeError('Failed to fetch');
            return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('Body read failed')); } }));
        } });
        await assert.rejects(provider.acquireResource({ accountId: account.id, conversationId: 'diagnostic-resource' },
            { id: 'file', kind: 'file', sourceUri: 'file-download:file_diagnostic' }, undefined, d => diagnostics.push(d)));
        const failed = diagnostics.find(d => d.code === 'CHATGPT_RESOURCE_REQUEST_FAILED');
        assert.ok(failed);
        assert.ok(failed.details && typeof failed.details === 'object' && !Array.isArray(failed.details));
        assert.equal(failed.details.phase, { locator: 'download_locator', payload: 'download_payload', signed: 'resource_fetch', body: 'read_body' }[failure]);
        assert.equal(failed.details.origin, failure === 'signed' || failure === 'body' ? 'https://files.example' : 'https://chatgpt.com');
        if (failure === 'payload') {
            const invalid = diagnostics.find(d => d.code === 'CHATGPT_DOWNLOAD_PAYLOAD_INVALID');
            assert.ok(invalid?.details && typeof invalid.details === 'object' && !Array.isArray(invalid.details));
            assert.deepEqual(invalid.details.responseKeys, ['status']);
            assert.equal(invalid.details.downloadUrlPresent, false);
        }
        assert.doesNotMatch(JSON.stringify(diagnostics), /do-not-log|private-path|accessToken/);
    });
}

test('external request diagnostics preserve the original failure and redact URL paths', async t => {
    const failure = new TypeError('Failed to fetch');
    t.mock.method(globalThis, 'fetch', async () => { throw failure; });
    const diagnostics: Diagnostic[] = [];
    await assert.rejects(acquireSourceResource({ id: 'external', kind: 'image',
        sourceUri: 'https://images.example/private?signature=secret' }, undefined, d => diagnostics.push(d)), error => error === failure);
    assert.equal(diagnostics.length, 1);
    assert.ok(diagnostics[0].details && typeof diagnostics[0].details === 'object' && !Array.isArray(diagnostics[0].details));
    assert.equal(diagnostics[0].details.origin, 'https://images.example');
    assert.equal(diagnostics[0].details.phase, 'fetch');
    assert.equal(diagnostics[0].details.errorName, 'TypeError');
    assert.equal(diagnostics[0].details.httpStatus, null);
    assert.doesNotMatch(JSON.stringify(diagnostics), /private|signature|secret/);
});

test('diagnostic observers cannot break successful downloads or detail admission', async t => {
    t.mock.method(console, 'warn', () => {});
    const account = await getOrCreateAccount('chatgpt', 'default');
    const provider = new ChatGPTProvider({ fetchFn: async url => {
        if (url.endsWith('/api/auth/session')) return Response.json(sessionGen('C_FILE_DOWNLOAD_SESSION_01'));
        if (url.includes('/conversation/source-chatgpt-1')) return Response.json(detailGen('C_DETAIL_L1_SOURCE_01'));
        if (url.includes('/backend-api/')) return Response.json(fileDownloadGen('C_DIAGNOSTIC_SIGNED_DOWNLOAD_01'));
        return new Response('attachment');
    } });
    const admission: Diagnostic[] = [];
    await provider.fetchConversationDetail(account.id, 'source-chatgpt-1', undefined, d => admission.push(d));
    const observation = admission.find(d => d.code === 'CHATGPT_DETAIL_ADMISSION');
    assert.ok(observation?.details && typeof observation.details === 'object' && !Array.isArray(observation.details));
    assert.equal(observation.details.accepted, true);
    assert.equal(observation.details.quality, 'complete');
    const result = await provider.acquireResource({ accountId: account.id, conversationId: 'diagnostic-resource' },
        { id: 'file', kind: 'file', sourceUri: 'file-download:file_diagnostic' }, undefined, () => { throw new Error('Observer failed'); });
    assert.equal(new TextDecoder().decode(result.bytes), 'attachment');
});
