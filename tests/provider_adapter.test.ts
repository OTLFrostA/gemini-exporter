import { rpcFixture, historicalFixture } from './helpers/nativeFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiProvider } from '../src/core/provider/gemini/geminiProvider.js';
import credentials from '../src/core/api/client/credentialManager.js';
import { getAllConversations, getConversationDetail } from '../src/core/api/client/pagination.js';
import type { PaginatedDetailResult, PaginationResult } from '../src/core/api/client/pagination.js';
import type { GeminiProviderClient } from '../src/core/provider/gemini/geminiContracts.js';
import type { DetailParseResult } from '../src/core/api/client/detailTypes.js';

// Native results pass through intact rather than enumerating or projecting message fields.
const detailFields = ['conversation', 'diagnostics', 'resourceHints', 'acquisitionHints', 'transport'] as const satisfies readonly (keyof PaginatedDetailResult)[];
const listFields = ['conversations', 'total', 'stoppedEarly', 'exhaustive', 'completionReason', 'diagnostics', 'hitGoogleLimit'] as const satisfies readonly (keyof PaginationResult)[];
type Assert<T extends true> = T;
const completeDetailCoverage: Assert<Exclude<keyof PaginatedDetailResult, typeof detailFields[number]> extends never ? true : false> = true;
const completeListCoverage: Assert<Exclude<keyof PaginationResult, typeof listFields[number]> extends never ? true : false> = true;
function detail(): PaginatedDetailResult {
    return rpcFixture({ id: 'adapter', title: 'Report', messages: [{ role: 'model', model: 'Model', content: '**Report**', thoughts: 'thinking', citations: [{ title: 'Citation', url: 'source' }], attachments: [{ type: 'image', url: 'original' }] }] },
        { decodedPayload: { wire: [null, 'evidence'] }, schemaDrift: ['drift'], turnsRejected: 1 });
}
async function list(): Promise<PaginationResult> {
    return getAllConversations({ async getConversationList() { return { conversations: [], nextPageToken: null }; } });
}
function client(data: PaginatedDetailResult, page: PaginationResult): GeminiProviderClient {
    return { async getConversationDetail() { return data; }, async getAllConversations() { return page; } };
}

test('adapter: all declared evidence and nested media retain values and identities', async () => {
    assert.equal(completeDetailCoverage && completeListCoverage, true);
    const data = detail();
    const mapped = await new GeminiProvider(client(data, await list())).fetchConversationDetail('adapter');
    assert.strictEqual(mapped, data);
    assert.deepEqual(mapped, data);
    for (const field of detailFields) assert.strictEqual(mapped[field], data[field], field);
    assert.strictEqual(mapped.conversation.messages, data.conversation.messages);
    assert.strictEqual(mapped.conversation.assets, data.conversation.assets);
});

test('adapter: absent and explicit undefined optional transport evidence keep their presence', async () => {
    const page = await list();
    for (const mode of ['absent', 'undefined'] as const) {
        const data = detail();
        delete data.transport.decodedPayload; delete data.transport.schemaDrift;
        if (mode === 'undefined') { data.transport.decodedPayload = undefined; data.transport.schemaDrift = undefined; }
        const mapped = await new GeminiProvider(client(data, page)).fetchConversationDetail('adapter');
        assert.strictEqual(mapped, data);
        assert.deepEqual(Object.keys(mapped.transport).sort(), Object.keys(data.transport).sort());
    }
});

test('adapter: native pagination aggregates and list completeness pass through', async () => {
    const data: DetailParseResult = detail();
    const aggregated = await getConversationDetail({ async fetchConversationPage() { return data; } }, 'adapter');
    const page = await list(); const provider = new GeminiProvider(client(aggregated, page));
    assert.strictEqual(await provider.fetchConversationDetail('adapter'), aggregated);
    const mappedList = await provider.listConversations();
    assert.deepEqual(mappedList, { ...page, items: page.conversations, hasMore: !!page.stoppedEarly, nextCursor: null });
    assert.strictEqual(mappedList.diagnostics, page.diagnostics);
});

test('adapter: native transport extensions are preserved without rebuilding the result', async () => {
    const data = detail();
    const page = Object.assign(await list(), { undeclared: 'not a companion field' });
    const provider = new GeminiProvider(client(data, page));
    assert.strictEqual(await provider.fetchConversationDetail('adapter'), data);
    assert.equal(Object.hasOwn(await provider.listConversations(), 'undeclared'), false);
});

test('adapter: readiness honestly narrows Error and non-Error credential failures', async () => {
    const original = credentials.resolveCred;
    try {
        for (const [failure, expected] of [
            [new Error('error-message'), 'error-message'],
            [{ message: 'object-message' }, 'object-message'],
            [{ message: 7 }, 'Gemini 凭据解析失败'],
            [{ message: '' }, 'Gemini 凭据解析失败'],
            [null, 'Gemini 凭据解析失败'], [undefined, 'Gemini 凭据解析失败'],
            ['string throw', 'Gemini 凭据解析失败']
        ] as const) {
            credentials.resolveCred = async () => { throw failure; };
            const readiness = await new GeminiProvider().checkReadiness();
            assert.deepEqual(readiness, { ready: false, error: expected });
        }
    } finally { credentials.resolveCred = original; }
});
