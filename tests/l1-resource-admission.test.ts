import test from 'node:test';
import assert from 'node:assert/strict';
import { createSourceResourceContext } from '../src/l1/resources/sourceResources.js';
import type { SourceConversationParseResult } from '../src/l1/parsers/parsingResult.js';

const key = { accountId: '10000000-0000-4000-8000-000000000001', conversationId: 'conversation-1' };
const asset = { id: 'image', kind: 'image' as const };
function parsed(text: string, inline: string | undefined): SourceConversationParseResult {
    return {
        conversationId: key.conversationId,
        conversation: {
            index: {},
            detail: {
                messages: [{ role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text }] }] }],
                assets: [asset], quality: { status: 'complete' },
            },
        },
        acquisitionHints: inline === undefined ? {} : { image: { dataBase64: Buffer.from(inline).toString('base64') } },
        diagnostics: [],
    };
}

test('admitted replacement never mixes resource bytes from different Detail candidates', async () => {
    const resources = createSourceResourceContext();
    try {
        // L1 callers invoke retainParsed only after L2 accepts the candidate.
        resources.retainParsed(key, parsed('first body', 'first bytes'));
        assert.equal(Buffer.from((await resources.acquire(key, asset)).bytes).toString(), 'first bytes');
        resources.retainParsed(key, parsed('second body', 'second bytes'));
        assert.equal(Buffer.from((await resources.acquire(key, asset)).bytes).toString(), 'second bytes');
        resources.retainParsed(key, parsed('third body', undefined));
        await assert.rejects(resources.acquire(key, asset), /No supported source locator/);
    } finally {
        resources.release();
    }
});

test('task resource readers remain isolated by full account/conversation identity', async () => {
    const resources = createSourceResourceContext();
    const other = { accountId: '10000000-0000-4000-8000-000000000002', conversationId: key.conversationId };
    try {
        resources.retainParsed(key, parsed('first', 'account-one'));
        resources.retainParsed(other, parsed('second', 'account-two'));
        assert.equal(Buffer.from((await resources.acquire(key, asset)).bytes).toString(), 'account-one');
        assert.equal(Buffer.from((await resources.acquire(other, asset)).bytes).toString(), 'account-two');
        resources.releaseConversation(key);
        await assert.rejects(resources.acquire(key, asset), /No supported source locator/);
        assert.equal(Buffer.from((await resources.acquire(other, asset)).bytes).toString(), 'account-two');
    } finally {
        resources.release();
    }
});

test('image acquisition rejects external and other-platform hosts before fetching stored or retained URLs', async t => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(Uint8Array.of(1)));
    const resources = createSourceResourceContext();
    t.after(() => resources.release());
    for (const sourceUri of [
        'https://cdn.sanity.io/example.png',
        'https://assets.grok.com/example.png',
        'https://images.openai.com.example.test/example.png',
        'https://images.openai.com:8443/example.png',
    ]) {
        resources.retainParsed(key, { ...parsed('image', undefined), acquisitionHints: { image: { url: sourceUri } } });
        await assert.rejects(resources.acquire(key, { ...asset, sourceUri }, undefined, undefined, undefined, 'chatgpt'),
            { code: 'RESOURCE_LOCATOR_UNAVAILABLE' });
    }
    assert.equal(fetch.mock.callCount(), 0);
    resources.retainParsed(key, { ...parsed('image', undefined),
        acquisitionHints: { image: { url: 'https://images.openai.com/example.png' } } });
    assert.deepEqual((await resources.acquire(key, asset, undefined, undefined, undefined, 'chatgpt')).bytes, Uint8Array.of(1));
    assert.equal(fetch.mock.callCount(), 1);
});

test('a direct platform image redirect is treated as unavailable without following or retrying it', async t => {
    const resources = createSourceResourceContext();
    t.after(() => resources.release());
    const response = Response.redirect('https://example.test/example.png');
    const fetch = t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
        assert.equal(init?.redirect, 'manual');
        return response;
    });
    await assert.rejects(resources.acquire(key, { ...asset, sourceUri: 'https://assets.grok.com/example.png' },
        undefined, undefined, undefined, 'grok'), { code: 'RESOURCE_LOCATOR_UNAVAILABLE' });
    assert.equal(fetch.mock.callCount(), 1);
});
