/**
 * tests/p1_i_regressions.test.ts
 * I 组「协议层与 provider 契约收尾」P1-075~089, P1-043/044 回归测试。
 *
 * 约定: P1-081/082 标记为"已被 #356 修复" —— 本文件用类型级 + 运行时断言锁住,
 * 若有人把联合类型 / hitGoogleLimit 必填加回来, tsc 或测试会失败。
 */
import type {
    ProviderPageResult,
    ProviderConversationItem,
} from '../src/core/provider/aiProvider.js';
import type { GeminiLiveSaveTriggerPayload } from '../src/core/protocol/events.js';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const Proto = require('../src/core/protocol/protocol.js');
const { ProviderRegistryClass } = require('../src/core/provider/providerRegistry.js');
const { GeminiProvider } = require('../src/core/provider/gemini/geminiProvider.js');
const { ChatGPTProvider, flattenChatGPTMapping } = require('../src/core/provider/chatgpt/chatgptProvider.js');
const { t } = require('../src/core/utils/i18n.js');
const enDict = require('../src/core/utils/locales/en.js');
const zhDict = require('../src/core/utils/locales/zh.js');

function fakeProvider(id: string, opts: { matchesUrl?: (u: string) => boolean; hostPatterns?: string[] } = {}) {
    const p: any = { id, name: id, hostPatterns: opts.hostPatterns || [] };
    if (opts.matchesUrl) p.matchesUrl = opts.matchesUrl;
    return p;
}

// ---------------------------------------------------------------- P1-075
test('P1-075 - second DELETION_ANCHOR requires the c_ prefix (anchored discipline)', () => {
    // Unquoted GzXR5e followed by a BARE hex token (no c_) must NOT match:
    // this is exactly the false-positive the old (?:c_)? allowed.
    const decoy = 'GzXR5e something happened deadbeef00112233 nearby';
    assert.strictEqual(decoy.match(Proto.DELETION_ANCHORS[1]), null);

    // Unquoted GzXR5e followed by a real c_-prefixed id still matches (fallback kept).
    const real = '...GzXR5e...c_feedface12345678...';
    const m = real.match(Proto.DELETION_ANCHORS[1]);
    assert.ok(m, 'unquoted anchor must still extract c_-prefixed ids');
    assert.strictEqual(m![1], 'feedface12345678');

    // Quoted form unchanged.
    const quoted = `[["wrb.fr","GzXR5e","c_aabbccdd11223344",null]]`;
    const m0 = quoted.match(Proto.DELETION_ANCHORS[0]);
    assert.ok(m0);
    assert.strictEqual(m0![1], 'aabbccdd11223344');
});

// ---------------------------------------------------------------- P1-077
test('P1-077 - typed self-mounts, no as-any escape hatches', () => {
    assert.strictEqual(Proto.GeminiProtocol, Proto, 'self mount intact');
    assert.strictEqual(Proto.default, Proto, 'default mount intact');
    assert.strictEqual(Proto.CrossWorldEvents, Proto.EVENTS, 'events mount intact');
    assert.strictEqual(globalThis.GeminiProtocol, Proto, 'globalThis mount intact');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/core/protocol/protocol.ts'), 'utf8');
    assert.ok(!/^\s*\/\/\s*@ts-ignore/m.test(src), '@ts-ignore directive must be gone');
    const codeOnly = src.replace(/\/\/.*$/gm, '');
    assert.ok(!codeOnly.includes('as any'), 'as any casts must be gone from protocol.ts');
});

// ------------------------------------------------------------- P1-078/079/080
test('P1-078 - duplicate registration of a DIFFERENT instance warns loudly', () => {
    const registry = new ProviderRegistryClass();
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => { warnings.push(args.join(' ')); };
    try {
        const first = fakeProvider('dup');
        const second = fakeProvider('dup');
        registry.register(first);
        // Same instance re-registered: silent no-op, no warning.
        registry.register(first);
        assert.strictEqual(warnings.length, 0, 'same-instance re-register must stay silent');
        // Different instance, same id: warn + overwrite.
        registry.register(second);
        assert.strictEqual(warnings.length, 1, 'different-instance duplicate must warn');
        assert.ok(warnings[0].includes('"dup"'), 'warning names the colliding id');
        assert.strictEqual(registry.get('dup'), second);
    } finally {
        console.warn = origWarn;
    }
});

test('P1-079 - setDefaultProviderId rejects unregistered ids', () => {
    const registry = new ProviderRegistryClass();
    assert.throws(() => registry.setDefaultProviderId('ghost'), /unregistered id "ghost"/);
    registry.register(fakeProvider('real'));
    registry.setDefaultProviderId('real');
    assert.strictEqual(registry.getDefault()?.id, 'real');
});

test('P1-080 - explicit matchesUrl=false is never overruled by hostPatterns', () => {
    const registry = new ProviderRegistryClass();
    registry.register(fakeProvider('strict', {
        matchesUrl: () => false, // explicit refusal...
        hostPatterns: ['https://example.com/*'], // ...with a broad pattern that must NOT win
    }));
    registry.register(fakeProvider('legacy', {
        hostPatterns: ['https://legacy.example.net/*'], // no matchesUrl at all
    }));
    assert.strictEqual(
        registry.findByUrl('https://example.com/page'), undefined,
        'explicit refusal must not fall back to hostPatterns'
    );
    assert.strictEqual(
        registry.findByUrl('https://legacy.example.net/x')?.id, 'legacy',
        'pattern-only providers still resolve via hostPatterns'
    );
});

// ------------------------------------------------------------- P1-081/082 (fixed by #356, locked here)
test('P1-081/082 - provider contract stays neutral: no union, no hitGoogleLimit', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ items: [] }) })) as any;
    try {
    // Type-level lock (checked by tsc): listConversations returns the single
    // neutral page type, so .items is directly accessible (impossible on the
    // old PaginationResult | ProviderListResult union)...
    const provider = new ChatGPTProvider();
    const page: ProviderPageResult<ProviderConversationItem> = await provider.listConversations({ maxPages: 1 });
    const items: ProviderConversationItem[] = page.items;
    assert.ok(Array.isArray(items));
    // ...and a minimal page literal compiles only when hitGoogleLimit /
    // diagnostics are NOT required (P1-082).
    const minimal: ProviderPageResult<ProviderConversationItem> = {
        items: [{ id: 'x', title: 'X' }],
    };
    assert.strictEqual(minimal.items[0].id, 'x');
    // Runtime lock: the neutral shape carries no Gemini-only fields.
    assert.strictEqual((page as any).hitGoogleLimit, undefined);
    assert.strictEqual((page as any).conversations, undefined, 'must not leak the old conversations[] shape');
    } finally {
        globalThis.fetch = realFetch;
    }
});

// ---------------------------------------------------------------- P1-084
test('P1-084 - live-save trigger payload is an explicit contract', () => {
    // Type-level lock (checked by tsc): only cid/reason/mockMode are legal.
    const payload: GeminiLiveSaveTriggerPayload = { cid: 'c_1', reason: 'turn_complete', mockMode: true };
    // messageBridge-style destructuring forwards a well-typed options bag.
    function fakeExecuteLiveSave(cid: string, reason: string, options: { mockMode?: boolean }): boolean {
        return !!cid && reason === 'turn_complete' && options.mockMode === true;
    }
    const { cid, reason, ...options } = payload;
    assert.ok(fakeExecuteLiveSave(cid, reason || 'turn_complete', options));
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/core/protocol/events.ts'), 'utf8');
    assert.ok(!/^\s*\[key: string\]: any;/m.test(src), 'index signature must be gone from the payload');
});

// ---------------------------------------------------------------- P1-085
test('P1-085 - missing timestamps are never fabricated with Date.now()', () => {
    const raw = {
        id: 'conv-no-time',
        title: 'No times',
        current_node: 'n1',
        mapping: {
            n1: {
                id: 'n1', parent: null, children: [],
                message: {
                    id: 'm1',
                    author: { role: 'user' },
                    // NOTE: no create_time
                    content: { content_type: 'text', parts: ['hello'] },
                },
            },
        },
    };
    const before = Date.now();
    const detail = flattenChatGPTMapping(raw);
    assert.strictEqual(detail.messages[0].timestamp, undefined, 'message timestamp stays missing');
    assert.strictEqual(detail.createdAt, null, 'conversation createdAt stays null');
    assert.strictEqual(detail.updatedAt, null, 'conversation updatedAt stays null');
    assert.ok(Date.now() - before < 5000, 'sanity: test ran fast');
});

test('P1-085 - listConversations leaves missing item timestamps missing', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
        ok: true,
        json: async () => ({ items: [{ id: 'c1', title: 'T1' }] }), // no update_time/create_time
    })) as any;
    try {
        const page = await new ChatGPTProvider().listConversations({ maxPages: 1 });
        assert.strictEqual(page.items.length, 1);
        assert.strictEqual(page.items[0].updatedAt, undefined, 'updatedAt stays missing, not Date.now()');
    } finally {
        globalThis.fetch = realFetch;
    }
});

// ---------------------------------------------------------------- P1-086
test('P1-086 - unknown convId never fabricates a dirty URL; thought objects never String()ed', () => {
    const raw = {
        // NOTE: no id / conversation_id anywhere, and no current_node so the
        // fallback path collects every node with a message.
        title: 'Mystery',
        mapping: {
            n1: {
                id: 'n1', parent: null, children: [],
                message: {
                    id: 'm1',
                    author: { role: 'assistant' },
                    create_time: 1726000001,
                    metadata: { thought: { opaque: 'object-thought' } },
                    content: { content_type: 'text', parts: ['answer'] },
                },
            },
            n2: {
                id: 'n2', parent: null, children: [],
                message: {
                    id: 'm2',
                    author: { role: 'assistant' },
                    create_time: 1726000002,
                    metadata: { thought: ['step one', 'step two'] },
                    content: { content_type: 'text', parts: ['answer 2'] },
                },
            },
        },
    };
    const detail: any = flattenChatGPTMapping(raw);
    assert.strictEqual(detail.url, undefined, 'no https://chatgpt.com/c/unknown dirty URL');
    const allThoughts: string[] = detail.messages.flatMap((m: any) => m.thoughts || []);
    assert.ok(allThoughts.length >= 2, 'object + array thoughts preserved');
    for (const th of allThoughts) {
        assert.ok(!th.includes('[object Object]'), `thought must not be "[object Object]": ${th}`);
    }
    assert.ok(allThoughts.some((th) => th.includes('opaque')), 'object thought serialized honestly');
    assert.ok(allThoughts.includes('step one') && allThoughts.includes('step two'), 'string[] thought handled');
});

// ---------------------------------------------------------------- P1-087
test('P1-087 - ChatGPT provider strings go through i18n keys', () => {
    for (const key of [
        'chatgptTitleFallback', 'chatgptUntitled', 'chatgptNotLoggedIn',
        'chatgptReadinessCheckFailed', 'chatgptNetworkUnavailable',
    ]) {
        assert.ok(typeof enDict[key] === 'string' && enDict[key].length > 0, `en dict needs ${key}`);
        assert.ok(typeof zhDict[key] === 'string' && zhDict[key].length > 0, `zh dict needs ${key}`);
    }
    const msg = t('chatgptNotLoggedIn');
    assert.ok(msg !== 'chatgptNotLoggedIn', 't() resolves the key');
    assert.ok(msg.includes('ChatGPT'), 'English default resolves');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/core/provider/chatgpt/chatgptProvider.ts'), 'utf8');
    assert.ok(!src.includes('未登录 ChatGPT，请先登录 chatgpt.com'), 'hard-coded Chinese error gone');
    assert.ok(!src.includes("'ChatGPT Conversation'"), 'hard-coded title fallback gone');
});

// ---------------------------------------------------------------- P1-088
test('P1-088 - checkReadiness never passes the slot id off as the account name', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/core/provider/gemini/geminiProvider.ts'), 'utf8');
    assert.ok(!src.includes('accountName: slot'), 'slot id must not masquerade as accountName');
    // Runtime: stub credential resolution to force the ready:true branch.
    const credMgr = require('../src/core/api/client/credentialManager.js');
    const orig = credMgr.resolveCred;
    credMgr.resolveCred = async () => ({ sid: 's', at: 'a', bl: 'b', accountSlot: 'u0' });
    try {
        const readiness = await new GeminiProvider().checkReadiness({ accountSlot: 'u0' });
        assert.strictEqual(readiness.ready, true);
        assert.strictEqual(readiness.accountSlot, 'u0');
        assert.ok(
            readiness.accountName === undefined || readiness.accountName === null,
            `accountName must be absent/null, got: ${readiness.accountName}`
        );
    } finally {
        credMgr.resolveCred = orig;
    }
});

// ---------------------------------------------------------------- P1-089
test('P1-089 - gemini hostPatterns cover everything matchesUrl accepts', () => {
    const gemini = new GeminiProvider();
    assert.ok(gemini.matchesUrl('https://gemini.google.com/app'), 'gemini host matches');
    assert.ok(gemini.matchesUrl('https://bard.google.com/app'), 'legacy bard host matches');
    for (const host of ['https://gemini.google.com/', 'https://bard.google.com/']) {
        const registry = new ProviderRegistryClass();
        registry.register(gemini);
        assert.strictEqual(registry.findByUrl(host)?.id, 'gemini', `findByUrl resolves ${host}`);
    }
    assert.ok(
        (gemini.hostPatterns as string[]).includes('https://bard.google.com/*'),
        'hostPatterns must include the bard pattern'
    );
    assert.ok(!gemini.matchesUrl('https://chatgpt.com'), 'unrelated host still refused');
});

// ------------------------------------------------------------- P1-043/044
test('P1-043 - AbortSignal reaches the in-flight fetch; pagination uses named constants', async () => {
    const realFetch = globalThis.fetch;
    const seen: any[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
        seen.push({ url, init });
        return { ok: true, json: async () => ({ items: [] }) };
    }) as any;
    try {
        const controller = new AbortController();
        await new ChatGPTProvider().listConversations({ signal: controller.signal, maxPages: 1 });
        assert.strictEqual(seen.length, 1);
        assert.strictEqual(seen[0].init.signal, controller.signal, 'signal must be passed to fetch');
        assert.strictEqual(seen[0].init.credentials, 'include', 'login cookies preserved');
        assert.ok(String(seen[0].url).includes('limit=28'), 'page size constant applied to the URL');
    } finally {
        globalThis.fetch = realFetch;
    }
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/core/provider/chatgpt/chatgptProvider.ts'), 'utf8');
    assert.ok(src.includes('CHATGPT_LIST_PAGE_SIZE'), 'magic 28 has a name');
    assert.ok(src.includes('CHATGPT_LIST_MAX_PAGES'), 'magic 50 has a name');
});

test('P1-043 - aborting mid-flight stops quietly instead of throwing', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((_url: any, init: any) => {
        const err: any = new Error('The operation was aborted.');
        err.name = 'AbortError';
        assert.ok(init && init.signal, 'fetch still receives the signal');
        return Promise.reject(err);
    }) as any;
    try {
        const controller = new AbortController();
        const page = await new ChatGPTProvider().listConversations({ signal: controller.signal, maxPages: 1 });
        assert.strictEqual(page.stoppedEarly, true, 'cancelled walk is marked stopped-early');
        assert.strictEqual(page.hasMore, false);
        assert.strictEqual(page.items.length, 0);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('P1-044 - HTTP errors produce an error-marked partial result, not a silent break', async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
        calls++;
        if (calls === 1) {
            return { ok: true, status: 200, json: async () => ({ items: Array.from({ length: 28 }, (_, i) => ({ id: `c${i}`, title: `T${i}`, update_time: '2024-01-01T00:00:00Z' })) }) };
        }
        return { ok: false, status: 429, json: async () => ({}) };
    }) as any;
    try {
        const page: any = await new ChatGPTProvider().listConversations({ maxPages: 5 });
        assert.strictEqual(page.items.length, 28, 'page-1 items preserved');
        assert.strictEqual(page.stoppedEarly, true);
        assert.ok(page.diagnostics && page.diagnostics.partial === true, 'partial flag set');
        assert.ok(String(page.diagnostics.error).includes('429'), 'HTTP status recorded');
        assert.strictEqual(page.diagnostics.httpStatus, 429);
    } finally {
        globalThis.fetch = realFetch;
    }
});
