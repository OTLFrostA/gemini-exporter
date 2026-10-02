import type { ApplicationProvider } from "../src/content/providerCompatibility.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AIProvider, ProviderConversationDetail, ProviderConversationItem, ProviderMessage, ProviderPageResult, ProviderListOptions } from '../src/core/provider/aiProvider.js';
import type { GeminiProviderClient, GeminiProviderListOptions, GeminiProviderConversationDetail, GeminiProviderPageResult } from '../src/core/provider/gemini/geminiContracts.js';
import credentials from '../src/core/api/client/credentialManager.js';
import { GeminiProvider } from '../src/core/provider/gemini/geminiProvider.js';
import { ProviderRegistryClass } from '../src/core/provider/providerRegistry.js';
import { resolveProvider } from '../src/core/provider/providerResolver.js';
import type { PaginationCompletionReason, PaginationResult } from '../src/core/api/client/pagination.js';
import { isPaginationExhaustive } from '../src/core/api/client/pagination.js';

type Assert<T extends true> = T;
type NotAny<T> = 0 extends (1 & T) ? false : true;
type RequiredField<T, K extends keyof T> = {} extends Pick<T, K> ? false : true;
type TypeContracts = [
    Assert<RequiredField<ProviderPageResult<ProviderConversationItem>, 'exhaustive'>>,
    Assert<RequiredField<ProviderPageResult<ProviderConversationItem>, 'completionReason'>>,
    Assert<string extends keyof ProviderConversationItem ? false : true>,
    Assert<'titleSource' extends keyof ProviderConversationDetail ? false : true>,
    Assert<'_raw' extends keyof ProviderConversationDetail ? false : true>,
    Assert<'documents' extends keyof ProviderMessage ? false : true>,
    Assert<'targetSid' extends keyof ProviderListOptions ? false : true>,
    Assert<NotAny<Parameters<AIProvider['fetchConversationDetail']>[1]>>,
    Assert<NotAny<GeminiProviderPageResult['diagnostics']>>,
    Assert<NotAny<GeminiProviderConversationDetail['messages'][number]['documents']>>,
    Assert<GeminiProvider extends AIProvider ? true : false>,
    Assert<GeminiProvider extends ApplicationProvider ? true : false>
];
const typeContracts: TypeContracts = [true, true, true, true, true, true, true, true, true, true, true, true];

function detail(): GeminiProviderConversationDetail {
    return { id: 'typed-chat', title: 'Report', titleSource: 'rpc', titles: { rpc: 'Report' },
        createdAt: null, updatedAt: 2, timestamp: 2, chatTime: 2,
        url: 'https://gemini.google.com/app/typed-chat', nextPageToken: null,
        messageCount: 1, attachmentCount: 1,
        messages: [{ role: 'model', content: 'Report', timestamp: 2,
            attachments: [{ type: 'image', originalUrl: 'https://example.com/image', alt: 'image' }],
            citations: [{ title: 'Source', url: 'https://example.com' }] }],
        _raw: ['unvalidated'], _debug: { turnsLen: 1 },
        schemaDrift: ['retained'], turnsRejected: 1, truncated: true,
        isTruncated: true, truncateReason: 'token_loop' };
}
function result(reason: PaginationCompletionReason): PaginationResult {
    const exhaustive = reason === 'natural_exhaustion';
    return { conversations: [{ id: 'typed-chat', title: 'Report', titleSource: 'rpc', titles: { rpc: 'Report' },
        createdAt: null, updatedAt: 2, timestamp: 2, chatTime: 2, messageCount: 1, url: 'url' }],
        total: 1, exhaustive, completionReason: reason,
        ...(exhaustive ? {} : { stoppedEarly: true as const }),
        hitGoogleLimit: reason === 'hit_google_limit',
        diagnostics: { startTime: 'start', endTime: 'end', maxPages: 2, incremental: true,
            totalPagesFetched: 1, totalConversations: 1, stopReason: reason,
            hitGoogleLimit: reason === 'hit_google_limit', pageHistory: [] } };
}
function client(list: PaginationResult, data = detail()): GeminiProviderClient {
    return { async getAllConversations() { return list; }, async getConversationDetail() { return data; } };
}

test('provider contract: neutral surface requires completeness and excludes Gemini evidence', () => {
    assert.ok(typeContracts.every(Boolean));
    const core: ProviderConversationDetail = { id: 'neutral', title: 'Neutral', messages: [{ role: 'assistant', content: 'text' }] };
    assert.equal(core.messages[0].content, 'text');
});

test('provider contract: all seven upstream reasons and diagnostic identity survive the adapter', async () => {
    const reasons: PaginationCompletionReason[] = ['natural_exhaustion', 'unchanged_boundary', 'token_loop', 'max_pages', 'hit_google_limit', 'error', 'aborted'];
    for (const reason of reasons) {
        const upstream = result(reason);
        const provider: ApplicationProvider = new GeminiProvider(client(upstream));
        const page = await provider.listConversations();
        const neutral: ProviderPageResult<ProviderConversationItem> = page;
        assert.equal(neutral.exhaustive, upstream.exhaustive);
        assert.equal(neutral.completionReason, reason);
        assert.equal(isPaginationExhaustive(page), upstream.exhaustive);
        assert.equal(page.hasMore, !!upstream.stoppedEarly);
        assert.equal(page.nextCursor, null);
        assert.equal(page.stoppedEarly, upstream.stoppedEarly);
        assert.equal(page.hitGoogleLimit, upstream.hitGoogleLimit);
        assert.strictEqual(page.diagnostics, upstream.diagnostics);
        assert.strictEqual(page.items, upstream.conversations);
        assert.strictEqual(page.conversations, upstream.conversations);
        assert.strictEqual(page.items[0].titles, upstream.conversations[0].titles);
    }
});

test('provider contract: typed batch/progress options and Gemini slot policy are forwarded intact', async () => {
    const upstream = result('unchanged_boundary');
    const signal = new AbortController().signal;
    let observedProgress = false;
    const options: GeminiProviderListOptions = { maxPages: 2, incremental: true, forceFull: true, targetSid: 'u2', signal,
        onPageBatch: async (batch, info) => {
            assert.equal(batch[0].titleSource, 'rpc');
            assert.deepEqual(info, { page: 1, hasMore: true });
            return { shouldStop: true, reason: 'watermark' };
        },
        onProgress: info => { observedProgress = true; assert.equal(info.batch?.[0].timestamp, 2); }
    };
    const provider = new GeminiProvider({ ...client(upstream), async getAllConversations(received) {
        assert.strictEqual(received, options);
        assert.deepEqual(await received?.onPageBatch?.(upstream.conversations, { page: 1, hasMore: true }), { shouldStop: true, reason: 'watermark' });
        received?.onProgress?.({ page: 1, added: 1, total: 1, hasMore: false, stoppedEarly: true, reason: 'watermark', batch: upstream.conversations });
        return upstream;
    } });
    await provider.listConversations(options);
    assert.equal(observedProgress, true);
});

test('provider contract: detailed media, provenance and parser evidence retain their typed identities', async () => {
    const data = detail();
    const slots: (string | null | undefined)[] = [];
    const provider: ApplicationProvider = new GeminiProvider({ ...client(result('natural_exhaustion')), async getConversationDetail(id, sid) {
        assert.equal(id, data.id); slots.push(sid); return data;
    } });
    const returned = await provider.fetchConversationDetail(data.id, { targetSid: 'u2', slot: 'u1' });
    await provider.fetchConversationDetail(data.id, { slot: 'u1' });
    await provider.fetchConversationDetail(data.id, { targetSid: '', slot: 'u3' });
    await provider.fetchConversationDetail(data.id);
    assert.deepEqual(slots, ['u2', 'u1', 'u3', null]);
    assert.deepEqual(returned, data);
    assert.strictEqual(returned.messages, data.messages);
    assert.strictEqual(returned._raw, data._raw);
    assert.strictEqual(returned._debug, data._debug);
    assert.equal(returned.messages[0].attachments?.[0].originalUrl, 'https://example.com/image');
    assert.equal(returned.messages[0].citations?.[0].url, 'https://example.com');
    assert.equal(returned.timestamp, 2);
    assert.equal(returned.truncateReason, 'token_loop');
});

test('provider contract: registry retains the application companion and resolver default side effect', () => {
    const registry = new ProviderRegistryClass();
    const provider = new GeminiProvider(client(result('natural_exhaustion')));
    registry.register(provider);
    assert.strictEqual(registry.findByUrl('https://bard.google.com/chat'), provider);
    assert.strictEqual(registry.getDefault(), provider);
    assert.deepEqual(registry.getAll(), [provider]);
    assert.equal(resolveProvider()?.id, 'gemini');
    assert.equal(registry.unregister('gemini'), true);
    assert.equal(registry.getDefault(), undefined);
});

test('provider contract: readiness retains default/account slot and existing error fallbacks', async () => {
    const original = credentials.resolveCred;
    const slots: (string | null | undefined)[] = [];
    try {
        credentials.resolveCred = async slot => {
            slots.push(slot);
            return { sid: 'sid', at: 'token', bl: 'build', accountSlot: slot || 'u0' };
        };
        const provider = new GeminiProvider(client(result('natural_exhaustion')));
        assert.deepEqual(await provider.checkReadiness(), { ready: true, accountSlot: 'u0' });
        assert.deepEqual(await provider.checkReadiness({ accountSlot: 'u2' }), { ready: true, accountSlot: 'u2' });
        assert.deepEqual(slots, ['u0', 'u2']);
        credentials.resolveCred = async () => ({ sid: 'sid', at: '', bl: '', accountSlot: 'u3' });
        assert.deepEqual(await provider.checkReadiness({ accountSlot: 'u3' }), {
            ready: false, accountSlot: 'u3', error: '未获取到有效认证凭据，请刷新 gemini.google.com'
        });
        credentials.resolveCred = async () => { throw new Error('credential failure'); };
        assert.deepEqual(await provider.checkReadiness(), { ready: false, error: 'credential failure' });
        credentials.resolveCred = async () => { throw null; };
        assert.deepEqual(await provider.checkReadiness(), { ready: false, error: 'Gemini 凭据解析失败' });
    } finally {
        credentials.resolveCred = original;
    }
});

test('provider contract: a neutral non-Gemini AIProvider registers without companion data', async () => {
    const registry = new ProviderRegistryClass();
    const neutralProvider: AIProvider = {
        id: 'neutral-fixture', name: 'Neutral fixture', hostPatterns: ['https://neutral.example/*'],
        matchesUrl: url => url.startsWith('https://neutral.example/'),
        async checkReadiness() { return { ready: true }; },
        async listConversations() { return { items: [], exhaustive: true, completionReason: 'fixture_complete' }; },
        async fetchConversationDetail(id) { return { id, title: 'Neutral', messages: [{ role: 'assistant', content: 'text' }] }; }
    };
    registry.register(neutralProvider);
    registry.setDefaultProviderId(neutralProvider.id);
    const byId: AIProvider | undefined = registry.get(neutralProvider.id);
    const all: AIProvider[] = registry.getAll();
    const byDefault: AIProvider | undefined = registry.getDefault();
    const byUrl: AIProvider | undefined = registry.findByUrl('https://neutral.example/chat');
    assert.strictEqual(byId, neutralProvider);
    assert.deepEqual(all, [neutralProvider]);
    assert.strictEqual(byDefault, neutralProvider);
    assert.strictEqual(byUrl, neutralProvider);
    assert.equal((await byId!.listConversations()).completionReason, 'fixture_complete');
    assert.equal((await byUrl!.fetchConversationDetail('neutral')).messages[0].role, 'assistant');
});

test('provider contract: an explicitly specialized registry preserves Gemini evidence', async () => {
    const registry = new ProviderRegistryClass<ApplicationProvider>();
    const provider = new GeminiProvider(client(result('hit_google_limit')));
    registry.register(provider);
    const page = await registry.get('gemini')!.listConversations();
    assert.equal(page.diagnostics.hitGoogleLimit, true);
    assert.equal(page.completionReason, 'hit_google_limit');
});
