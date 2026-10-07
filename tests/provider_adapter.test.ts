import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiProvider } from '../src/core/provider/gemini/geminiProvider.js';
import credentials from '../src/core/api/client/credentialManager.js';
import { getAllConversations, getConversationDetail } from '../src/core/api/client/pagination.js';
import type { PaginatedDetailResult, PaginationResult } from '../src/core/api/client/pagination.js';
import type { GeminiProviderClient } from '../src/core/provider/gemini/geminiContracts.js';
import type { DetailParseResult } from '../src/core/compatibility/gemini/parseDetail.js';

// If the upstream companion gains a field, adapter coverage must be revisited.
const detailFields = ['id', 'title', 'messages', 'url', 'createdAt', 'updatedAt', 'messageCount', 'titleSource', 'titles', 'timestamp', 'chatTime', 'nextPageToken', 'attachmentCount', 'schemaDrift', 'turnsRejected', 'truncated', 'isTruncated', 'truncateReason', '_raw', '_debug'] as const satisfies readonly (keyof PaginatedDetailResult)[];
const listFields = ['conversations', 'total', 'stoppedEarly', 'exhaustive', 'completionReason', 'diagnostics', 'hitGoogleLimit'] as const satisfies readonly (keyof PaginationResult)[];
type Assert<T extends true> = T;
const completeDetailCoverage: Assert<Exclude<keyof PaginatedDetailResult, typeof detailFields[number]> extends never ? true : false> = true;
const completeListCoverage: Assert<Exclude<keyof PaginationResult, typeof listFields[number]> extends never ? true : false> = true;

function detail(): PaginatedDetailResult {
    return { id: 'adapter', title: 'Report', titleSource: 'rpc', titles: { rpc: 'Report' },
        createdAt: null, updatedAt: null, chatTime: null, timestamp: null,
        url: 'https://gemini.google.com/app/adapter', nextPageToken: null,
        messageCount: 1, attachmentCount: 1,
        messages: [{ id: 'reply', role: 'model', content: 'Report', timestamp: null,
            documents: [{ id: 'doc', title: 'Document', chipUrl: 'chip', sections: ['section'], links: [], url: 'doc-url', localName: 'report.md', type: 'doc', contentMarkdown: '# Report' }],
            attachments: [{ type: 'image', originalUrl: 'original', resolvedUrl: 'resolved', alt: 'Image', generation: { chatId: 'adapter', generationOrdinal: 0 } }],
            citations: [{ title: 'Citation', url: 'source' }],
            sources: [{ wire: 'source' }], thoughts: ['thinking'],
            structuredContent: { children: [] }, groundingCitationMarkers: ['marker'] }],
        _raw: { wire: [null, 'evidence'] }, _debug: { turnsLen: 1, innerKeys: ['wire'] },
        schemaDrift: ['drift'], turnsRejected: 1, truncated: true,
        isTruncated: true, truncateReason: 'token_loop' };
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
    assert.notStrictEqual(mapped, data);
    assert.deepEqual(mapped, data);
    for (const field of detailFields) assert.strictEqual(mapped[field], data[field], field);
    assert.strictEqual(mapped.messages[0].documents, data.messages[0].documents);
    assert.strictEqual(mapped.messages[0].structuredContent, data.messages[0].structuredContent);
    assert.strictEqual(mapped.messages[0].attachments, data.messages[0].attachments);
});

test('adapter: absent, explicit undefined and nullable optional detail evidence keep their presence', async () => {
    const page = await list();
    for (const mode of ['absent', 'undefined', 'null-debug'] as const) {
        const data = detail();
        for (const field of ['_raw', '_debug', 'schemaDrift', 'turnsRejected', 'truncated', 'isTruncated', 'truncateReason'] as const) delete data[field];
        if (mode === 'undefined') { data._raw = undefined; data.schemaDrift = undefined; data.truncated = undefined; }
        if (mode === 'null-debug') data._debug = null;
        const mapped = await new GeminiProvider(client(data, page)).fetchConversationDetail('adapter');
        assert.deepEqual(mapped, data);
        assert.deepEqual(Object.keys(mapped).sort(), Object.keys(data).sort());
    }
});

test('adapter: actual pagination aggregates match the previous declared-field spread mapping', async () => {
    const data: DetailParseResult = detail();
    const aggregated = await getConversationDetail({ async fetchConversationPage() { return data; } }, 'adapter');
    const page = await list();
    const provider = new GeminiProvider(client(aggregated, page));
    const mappedDetail = await provider.fetchConversationDetail('adapter');
    assert.deepEqual(mappedDetail, { ...aggregated, id: aggregated.id, title: aggregated.title, messages: aggregated.messages });
    const mappedList = await provider.listConversations();
    assert.deepEqual(mappedList, { ...page, items: page.conversations, hasMore: !!page.stoppedEarly, nextCursor: null });
    assert.equal(Object.hasOwn(mappedList, 'stoppedEarly'), Object.hasOwn(page, 'stoppedEarly'));
    assert.strictEqual(mappedList.diagnostics, page.diagnostics);
    page.stoppedEarly = undefined;
    assert.equal(Object.hasOwn(await provider.listConversations(), 'stoppedEarly'), true);
});

test('adapter: undeclared top-level extensions are excluded without dropping nested wire evidence', async () => {
    const data = Object.assign(detail(), { undeclared: 'not a companion field' });
    const page = Object.assign(await list(), { undeclared: 'not a companion field' });
    const provider = new GeminiProvider(client(data, page));
    const mappedDetail = await provider.fetchConversationDetail('adapter');
    assert.equal(Object.hasOwn(mappedDetail, 'undeclared'), false);
    assert.strictEqual(mappedDetail._raw, data._raw);
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
