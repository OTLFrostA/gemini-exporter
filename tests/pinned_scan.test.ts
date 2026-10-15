import { indexFixture } from './helpers/indexFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllConversations } from '../src/core/api/client/pagination.js';
import type { ConversationListItem, ListParseResult } from '../src/core/parsers/gemini/rpc/parseList.js';

function item(id: string, timestamp = 1700000000000): ConversationListItem {
    return indexFixture({ id, title: id, titleSource: 'rpc', titles: { rpc: id }, createdAt: timestamp,
        updatedAt: timestamp, chatTime: timestamp, timestamp, messageCount: 0, url: '' });
}
function page(ids: string[], token: string | null = null): ListParseResult {
    return { conversations: ids.map(id => item(id)), nextPageToken: token };
}

test('all-history scan follows both independent chains, persists every page, dedupes overlap, and resets cursors', async () => {
    const responses = [page(['pinned-a'], 'same-token'), page(['shared']), page(['shared', 'recent-a'], 'same-token'), page(['recent-b'])];
    const requests: { token: string | null | undefined; filter: unknown }[] = [];
    const batches: { page: number; ids: string[]; hasMore: boolean }[] = [];
    const result = await getAllConversations({ async getConversationList(token, _sid, filter) {
        requests.push({ token, filter }); return responses[requests.length - 1];
    } }, { includePinned: true, onPageBatch: async (items, info) => {
        batches.push({ ...info, ids: items.map(c => c.id) });
        // Pinned completion must never authorize stopping before the recent chain.
        if (info.page === 2) return { shouldStop: true };
    } });
    assert.deepEqual(requests, [
        { token: null, filter: [1, null, 1] }, { token: 'same-token', filter: [1, null, 1] },
        { token: null, filter: undefined }, { token: 'same-token', filter: undefined }
    ]);
    assert.deepEqual(batches.map(b => b.page), [1, 2, 3, 4]);
    assert.deepEqual(batches.map(b => b.hasMore), [true, true, true, false]);
    assert.deepEqual(result.conversations.map(c => c.id), ['pinned-a', 'shared', 'recent-a', 'recent-b']);
    assert.equal(result.total, 4);
    assert.equal(result.exhaustive, true);
    assert.equal(result.completionReason, 'natural_exhaustion');
    assert.deepEqual(result.diagnostics.pageHistory.map(p => p.listKind), ['pinned', 'pinned', 'recent', 'recent']);
});

test('an empty pinned chain still reads recent history and delivers contiguous empty-page evidence', async () => {
    const responses = [page([]), page(['recent'])];
    let calls = 0;
    const pages: number[] = [];
    const result = await getAllConversations({ async getConversationList() { return responses[calls++]; } },
        { includePinned: true, onPageBatch: async (_items, info) => { pages.push(info.page); } });
    assert.equal(calls, 2); assert.deepEqual(pages, [1, 2]);
    assert.equal(result.total, 1); assert.equal(result.exhaustive, true);
});

test('a pinned-only account must exhaust its empty recent chain before certifying coverage', async () => {
    const responses = [page(['pinned']), page([])]; let calls = 0;
    const result = await getAllConversations({ async getConversationList() { return responses[calls++]; } }, { includePinned: true });
    assert.equal(calls, 2); assert.equal(result.exhaustive, true); assert.equal(result.total, 1);
});

test('page budget, errors, limits and cancellation at the group boundary cannot certify complete coverage', async () => {
    for (const cause of ['budget', 'error', 'limit', 'abort', 'sparse'] as const) {
        let calls = 0;
        const client = { aborted: false, async getConversationList(): Promise<ListParseResult> {
            if (calls++ === 0) return page(['pinned']);
            if (cause === 'error') throw new Error('network failed');
            if (cause === 'limit') return { ...page([]), failure: 'hit_google_limit', _debug: { error: 'BARD_ERROR_INFO', bardError: 'limit', textLen: 0, rawPreview: '', topParsed: null } };
            if (cause === 'sparse') return page([], 'not-exhausted');
            throw new Error('must stop before recent request');
        } };
        const result = await getAllConversations(client, { includePinned: true, maxPages: cause === 'budget' ? 1 : 5,
            onPageBatch: async () => { if (cause === 'abort') client.aborted = true; } });
        assert.equal(result.exhaustive, false, cause);
        assert.equal(result.total, 1, cause);
        assert.equal(result.completionReason, cause === 'budget' ? 'max_pages' : cause === 'limit' ? 'hit_google_limit' : cause === 'abort' ? 'aborted' : 'error', cause);
    }
});

test('a malformed pinned chain is not treated as an empty account', async () => {
    let calls = 0;
    const result = await getAllConversations({ async getConversationList() {
        calls++; return { ...page([]), failure: 'invalid_response' as const, _debug: { error: 'NO_INNER_STR' as const, bardError: null, textLen: 3, rawPreview: 'bad', topParsed: null } };
    } }, { includePinned: true });
    assert.equal(calls, 1); assert.equal(result.exhaustive, false); assert.equal(result.completionReason, 'error');
});
