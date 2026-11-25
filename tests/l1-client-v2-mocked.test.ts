import { describe as __suiteDescribe } from 'node:test';
import { parseGeminiRequest } from "../src/l1/parsers/gemini/rpc/request.js";
import { geminiListPage } from "./fixtures/providers/geminiListCapture.js";
import { geminiListPages } from "./fixtures/providers/geminiListCapture.js";
import { GEMINI_LIST_CAPTURE } from "./fixtures/providers/geminiListCapture.js";
import test from "node:test";
import { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ports } from "./helpers/l1V2UnitMocks.js";
import { GEMINI_ACCOUNT } from "./helpers/l1V2UnitMocks.js";
import { CHATGPT_ACCOUNT } from "./helpers/l1V2UnitMocks.js";
import { DEFAULT_ACCOUNT } from "./helpers/l1V2UnitMocks.js";
import { GeminiProvider } from "../src/l1/client/gemini/geminiProvider.js";
import { ChatGPTProvider } from "../src/l1/client/chatgpt/chatgptProvider.js";
import { ConfirmedGeminiConversationNotFound } from "../src/l1/client/gemini/geminiClient.js";
import { createSourceResourceContext } from "../src/l1/resources/sourceResources.js";
import { type Diagnostic } from "../src/shared/diagnostics/diagnostic.js";
import { mergeConversationPages } from "../src/l1/parsers/gemini/rpc/mergePages.js";
import { sourceDetail } from "./helpers/l1SourceFixture.js";
import { sourceMessage } from "./helpers/l1SourceFixture.js";
import { parseList } from "../src/l1/parsers/gemini/rpc/parseList.js";
import { type ListParseResult } from "../src/l1/parsers/gemini/rpc/parseList.js";
import { listGen as geminiListGen } from "./fixtures/providers/gemini.js";
import { listGen as chatgptListGen } from "./fixtures/providers/chatgpt.js";
import { sessionGen as chatgptSessionGen } from "./fixtures/providers/chatgptSession.js";
import { type Account } from "../src/l2/accountRegistry.js";
import { type ConversationKey } from "../src/l2/conversationKey.js";
import { type DomainAsset } from "../src/l2/conversationDetail.js";
import { type PageObservation } from "../src/l2/pageObservation.js";
import { type ResourceBytes } from "../src/shared/resources/resourceResult.js";
import { type AIProvider } from "../src/l1/client/aiProvider.js";
import { type ProviderListOptions } from "../src/l1/client/aiProvider.js";
import { type PageEvidence } from "../src/l1/client/aiProvider.js";
import { type CommittedListPage } from "../src/l1/client/aiProvider.js";
import { type ListEnd } from "../src/l1/client/aiProvider.js";
import { type ProviderReadiness } from "../src/l1/client/aiProvider.js";
import { type GeminiNetworkBatchexecutePayload } from "../src/l1/protocol/gemini/events.js";
import { type GeminiTakeoutZipRaw } from "../src/l1/imports/takeout/readArchive.js";
import { type GeminiTakeoutParseResult } from "../src/l1/parsers/gemini/takeout/parseConversation.js";
import { type SourceConversationParseResult } from "../src/l1/parsers/parsingResult.js";
import { ProviderRegistryClass } from "../src/l1/client/providerRegistry.js";
import { parseGeminiIndexObservation } from "../src/l1/parsers/gemini/parseIndexObservation.js";
import { parseGeminiRpcConversation } from "../src/l1/parsers/gemini/rpc/parseConversation.js";
import { geminiRpcPacket } from "./fixtures/providers/geminiRpcCapture.js";
import { GEMINI_DETAIL_CAPTURE } from "./fixtures/providers/geminiRpcCapture.js";
import { parseGeminiTakeoutArchive } from "../src/l1/parsers/gemini/takeout/parseConversation.js";
import { PLATFORM_HOSTS } from "../src/shared/platformHosts.js";
import assert__s3 from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { type TestContext } from "node:test";
import fs__s4 from "node:fs";
import path__s4 from "node:path";
import { handleHttp429 } from "../src/l1/client/gemini/api/retryPolicy.js";
import { interruptibleSleep } from "../src/l1/client/gemini/api/retryPolicy.js";

__suiteDescribe("l1-client-v2-mocked", () => {
beforeEach(() => ports.reset());
const route = async () => 'u0';
const client = (pages: ListParseResult[]) => ({
    async getConversationList() {
        const next = pages.shift();
        if (!next) throw new Error('Unexpected source request');
        return next;
    },
    async getConversationDetail() { return sourceDetail(); },
});

test('Gemini Client commits canonical keyless Index/page evidence before callback', async () => {
    const pages = geminiListPages();
    const provider = new GeminiProvider(client(pages.map(page => parseList(page.responseBody))), route);
    const seen: Array<{ page: number; committed: number; head: boolean }> = [];
    const end = await provider.listConversations({
        accountId: GEMINI_ACCOUNT.id, streamId: 'recent',
        onPageCommitted: async info => {
            seen.push({ page: info.page, committed: ports.indexes.length, head: !!info.scanHead });
            return false;
        },
    });
    assert.equal(end, 'source_end');
    assert.deepEqual(seen, pages.map((_, index) => ({ page: index + 1, committed: index + 1, head: index === 0 })));
    assert.equal(ports.indexes.length, GEMINI_LIST_CAPTURE.pageCount);
    assert.deepEqual(ports.indexes.map(call => call.items.length), [31, ...Array<number>(21).fill(20), 7]);
    assert.deepEqual(ports.indexes.flatMap(call => call.items.map(row => row.conversationId)),
        Array.from({ length: GEMINI_LIST_CAPTURE.totalRows }, (_, index) => String(index + 1).padStart(16, '0')));
    assert.equal(ports.indexes.reduce((sum, call) => sum + call.items.length, 0), GEMINI_LIST_CAPTURE.totalRows);
    assert.equal(ports.indexes[0].items[0].conversationId, GEMINI_LIST_CAPTURE.first.id);
    assert.equal(ports.indexes[22].items.at(-1)?.conversationId, GEMINI_LIST_CAPTURE.last.id);
    assert.equal(ports.indexes[0].accountId, GEMINI_ACCOUNT.id);
    assert.equal(ports.indexes[0].page?.requestCursor, null);
    assert.equal(ports.indexes[0].page?.keys[0]?.time, GEMINI_LIST_CAPTURE.first.updatedAt);
    assert.equal(ports.indexes[22].page?.nextCursor, null);
    assert.ok(ports.indexes.every(call => call.page?.valid && call.page?.requestKnown));
});

test('Gemini Client passes the host-provided slot to acquisition and rechecks it before committing', async () => {
    ports.current = { providerId: 'gemini', accountId: GEMINI_ACCOUNT.id, slot: 'u2' };
    const provider = new GeminiProvider({
        ...client([]),
        async getConversationList(_cursor, slot) {
            assert.equal(slot, 'u2');
            ports.current = { providerId: 'gemini', accountId: GEMINI_ACCOUNT.id, slot: 'u3' };
            return parseList(geminiListPage().responseBody);
        },
    });
    await assert.rejects(provider.listConversations({
        accountId: GEMINI_ACCOUNT.id, streamId: 'recent',
    }), { code: 'ACCOUNT_CHANGED' });
    assert.deepEqual(ports.lookups, [GEMINI_ACCOUNT.id]);
    assert.equal(ports.indexes.length, 0);
});

test('L1 preserves Index facts without certifying an untrusted page or default account', async () => {
    const untrusted = parseList(geminiListPage().responseBody);
    untrusted.pageEvidence.valid = false;
    await assert.rejects(new GeminiProvider(client([untrusted]), route).listConversations({
        accountId: GEMINI_ACCOUNT.id, streamId: 'recent',
    }), /Unverified Gemini list page/);
    assert.equal(ports.indexes.length, 1);
    assert.equal(ports.indexes[0].page?.valid, false);
    ports.reset();
    await assert.rejects(new GeminiProvider(client([parseList(geminiListPage(22).responseBody)]), route).listConversations({
        accountId: DEFAULT_ACCOUNT.id, streamId: 'recent',
    }), /Unverified Gemini list endpoint/);
    assert.equal(ports.indexes.length, 1);
    assert.equal(ports.indexes[0].page, undefined, 'default identity cannot contribute trusted Coverage');
});

test('Gemini provider-limit is conveyed as a committed empty request-bound page, not estimated history length', async () => {
    const limit = parseList(geminiListGen('G_L1_CLIENT_V2_MOCKED_02'));
    let callbacks = 0;
    const end = await new GeminiProvider(client([parseList(geminiListPage().responseBody), limit]), route)
        .listConversations({ accountId: GEMINI_ACCOUNT.id, streamId: 'recent',
            onPageCommitted: async () => { callbacks++; return false; } });
    assert.equal(end, 'provider_limit');
    assert.equal(callbacks, 2);
    assert.equal(ports.indexes.length, 2);
    assert.deepEqual(ports.indexes[1].items, []);
    assert.deepEqual(ports.indexes[1].page?.keys, []);
    assert.equal(ports.indexes[1].page?.terminal, 'provider_limit');
    assert.equal(ports.indexes[1].page?.requestCursor, parseGeminiRequest(geminiListPage(1).requestBody).list!.requestCursor);
});

test('failed L2 Index commit prevents Client progress and next-page acquisition', async () => {
    ports.indexError = new Error('mock Index transaction failed');
    let callback = false, requests = 0;
    const provider = new GeminiProvider({
        async getConversationList() { requests++; return parseList(geminiListPage().responseBody); },
        async getConversationDetail() { return sourceDetail(); },
    }, route);
    await assert.rejects(provider.listConversations({
        accountId: GEMINI_ACCOUNT.id, streamId: 'recent',
        onPageCommitted: async () => { callback = true; return false; },
    }), /mock Index transaction failed/);
    assert.equal(requests, 1);
    assert.equal(callback, false);
    assert.equal(ports.indexes.length, 0);
});

test('Gemini Detail may retain source bytes only for L2 accepted candidates', async () => {
    const base = sourceDetail();
    const asset = { id: 'current-image', kind: 'image' as const, mediaType: 'image/png' };
    // Acquisition hints are a read-only L1 side channel; construct the fixture
    // with its image and bytes rather than mutating an already parsed result.
    const parsed = {
        ...base,
        conversation: {
            ...base.conversation,
            detail: { ...base.conversation.detail, assets: [...base.conversation.detail.assets, asset] },
        },
        acquisitionHints: { ...base.acquisitionHints, [asset.id]: { dataBase64: 'AQID' } },
    };
    const resources = createSourceResourceContext();
    const provider = new GeminiProvider({
        async getConversationList() { return parseList(geminiListPage().responseBody); },
        async getConversationDetail() { return parsed; },
    }, route, resources);
    const key = { accountId: GEMINI_ACCOUNT.id, conversationId: parsed.conversationId };
    try {
        ports.detailDecision = { accepted: false, changed: false };
        assert.equal(await provider.fetchConversationDetail(GEMINI_ACCOUNT.id, parsed.conversationId), undefined);
        await assert.rejects(resources.acquire(key, asset), /No supported source locator/);
        assert.equal(ports.details.length, 1);
        assert.equal(ports.details[0].detail.assets[0].id, asset.id);
        assert.equal(ports.details[0].indexFields?.titleSource, 'provider');

        ports.detailDecision = { accepted: true, changed: false };
        await provider.fetchConversationDetail(GEMINI_ACCOUNT.id, parsed.conversationId);
        assert.deepEqual((await resources.acquire(key, asset)).bytes, Uint8Array.of(1, 2, 3));
        assert.equal(ports.details.length, 2);
    } finally { resources.release(); }
});

test('source-confirmed target deletion waits for L2 committed deletion and reports stable not-found', async () => {
    const provider = new GeminiProvider({
        async getConversationList() { return parseList(geminiListPage().responseBody); },
        async getConversationDetail() {
            throw new ConfirmedGeminiConversationNotFound('c_source_chat_123');
        },
    }, route);
    const steps: string[] = [];
    ports.beforeDeletionCommit = async () => { steps.push('commit'); };
    await assert.rejects(provider.fetchConversationDetail(GEMINI_ACCOUNT.id, 'source_chat_123'),
        /conversation_not_found/);
    assert.deepEqual(steps, ['commit']);
    assert.deepEqual(ports.deletions, [[GEMINI_ACCOUNT.id, 'source_chat_123']]);
    ports.reset();
    ports.deletionError = new Error('mock deletion commit failure');
    await assert.rejects(provider.fetchConversationDetail(GEMINI_ACCOUNT.id, 'source_chat_123'),
        /mock deletion commit failure/);
});

test('Client refuses changed account route and mismatched Provider before committing anything', async () => {
    let checks = 0, fetched = false;
    const provider = new GeminiProvider({
        async getConversationList() { fetched = true; return parseList(geminiListPage().responseBody); },
        async getConversationDetail() { fetched = true; return sourceDetail(); },
    }, async () => ++checks === 1 ? 'u0' : 'u1');
    await assert.rejects(provider.listConversations({ accountId: GEMINI_ACCOUNT.id, streamId: 'recent' }),
        /route changed/);
    assert.equal(fetched, false);
    assert.equal(ports.indexes.length, 0);
    const foreign = new GeminiProvider(client([parseList(geminiListPage().responseBody)]), route);
    await assert.rejects(foreign.listConversations({ accountId: CHATGPT_ACCOUNT.id, streamId: 'recent' }),
        /Provider account mismatch/);
});

test('ChatGPT uses the same v2 Index/page port and checks native completeness before source_end', async () => {
    const seenWorkspaceHeaders: Array<string | null> = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
        if (!url.endsWith('/api/auth/session')) {
            seenWorkspaceHeaders.push(new Headers(init?.headers).get('ChatGPT-Account-ID'));
        }
        return new Response(JSON.stringify(
            url.endsWith('/api/auth/session')
                ? chatgptSessionGen('C_L1_CLIENT_V2_MOCKED_03')
                : chatgptListGen('C_L1_CLIENT_V2_MOCKED_04'),
        ), { status: 200 });
    };
    const provider = new ChatGPTProvider({ fetchFn });
    assert.deepEqual(await provider.checkReadiness(CHATGPT_ACCOUNT.id), { ready: true });
    const mismatched = new ChatGPTProvider({
        fetchFn: async () => new Response(JSON.stringify(chatgptSessionGen('C_L1_CONTRACT_20')), { status: 200 }),
    });
    assert.equal((await mismatched.checkReadiness(CHATGPT_ACCOUNT.id)).ready, false);
    const committed: number[] = [];
    const end = await provider.listConversations({
        accountId: CHATGPT_ACCOUNT.id, streamId: 'recent',
        onPageCommitted: async progress => { committed.push(ports.indexes.length); assert.ok(progress.scanHead); return false; },
    });
    assert.equal(end, 'source_end');
    assert.deepEqual(seenWorkspaceHeaders, ['workspace-1']);
    assert.deepEqual(committed, [1]);
    assert.deepEqual(ports.indexes[0].items, [{
        conversationId: 'chatgpt-source', fields: {
            title: 'Owned title', titleSource: 'provider', createdAt: 1700000000000,
            updatedAt: 1700000010000,
        },
    }]);
    assert.equal(ports.indexes[0].page?.keys[0]?.time, 1700000010000);
    assert.equal(ports.indexes[0].page?.nextCursor, null);

    ports.reset();
    const invalid = new ChatGPTProvider({ fetchFn: async url => new Response(JSON.stringify(
        url.endsWith('/api/auth/session')
            ? chatgptSessionGen('C_L1_CLIENT_V2_MOCKED_05')
            : chatgptListGen('C_L1_CLIENT_V2_MOCKED_06'),
    ), { status: 200 }) });
    await assert.rejects(invalid.listConversations({ accountId: CHATGPT_ACCOUNT.id, streamId: 'recent' }),
        /Unverified ChatGPT list page/);
    assert.equal(ports.indexes.length, 1);
    assert.equal(ports.indexes[0].page?.valid, false);
});


test('Detail diagnostics expose parsing evidence and L2 admission without exporting source bodies', async () => {
    const page = sourceDetail({ turnsRejected: 2, messages: [{
        ...sourceMessage('newer-answer', 'Private source body'), timestamp: 1700000001000,
    }] });
    const parsed = { ...mergeConversationPages([page], 'token_loop', false), transport: page.transport };
    const provider = new GeminiProvider({
        async getConversationList() { return parseList(geminiListPage().responseBody); },
        async getConversationDetail() { return parsed; },
    }, route);
    ports.detailDecision = { accepted: false, changed: false };
    const events: Diagnostic[] = [];
    await provider.fetchConversationDetail(GEMINI_ACCOUNT.id, parsed.conversationId, undefined, event => events.push(event));
    assert.ok(events.some(event => event.code === 'GEMINI_TURNS_REJECTED'));
    assert.deepEqual(events.find(event => event.code === 'CONVERSATION_VERSION_MISMATCH')?.details,
        { sourceVersion: 1700000000000, newerMessages: [{ id: 'newer-answer', role: 'assistant', timestamp: 1700000001000 }] });
    const pagination = events.find(event => event.code === 'GEMINI_DETAIL_PAGES')?.details;
    assert.ok(pagination && typeof pagination === 'object' && !Array.isArray(pagination));
    assert.equal(pagination.pageCount, 1);
    assert.equal(pagination.truncation, 'token_loop');
    assert.equal(pagination.versionMismatch, true);
    const summary = events.find(event => event.code === 'GEMINI_DETAIL_PARSE_RESULT')?.details;
    assert.ok(summary && typeof summary === 'object' && !Array.isArray(summary));
    assert.equal(summary.quality, 'partial');
    assert.equal(summary.rejectedTurns, 2);
    assert.equal(summary.messageCount, 1);
    assert.deepEqual(events.find(event => event.code === 'GEMINI_DETAIL_ADMISSION')?.details,
        { accepted: false, changed: false });
    assert.doesNotMatch(JSON.stringify(events), /Private source body|decodedPayload|dataBase64/);
    await provider.fetchConversationDetail(GEMINI_ACCOUNT.id, parsed.conversationId, undefined,
        () => { throw new Error('Diagnostic observer failed'); });
    assert.equal(ports.details.length, 2, 'diagnostic listener failures do not suppress source admission');
    assert.equal(ports.details[1].detail.quality.status, 'partial');
});
});

__suiteDescribe("l1-outbound-contract", () => {
type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type ParseTakeoutArchive = typeof import('../src/l1/imports/takeout/readArchive.js').parseGeminiTakeoutZipArchive;
type ParseOpenAIArchive = typeof import('../src/l1/imports/openai/parseArchive.js').parseOpenAIExportArchive;
type FrozenPageEvidence = Omit<PageObservation, 'providerId' | 'accountId'>;

type Contract = [
    Assert<Equal<PageEvidence, FrozenPageEvidence>>,
    Assert<Equal<keyof ProviderListOptions, 'accountId' | 'streamId' | 'signal' | 'onPageCommitted' | 'onDiagnostic'>>,
    Assert<Equal<ProviderListOptions['accountId'], Account['id']>>,
    Assert<Equal<ProviderListOptions['onPageCommitted'],
        ((info: CommittedListPage) => Promise<boolean>) | undefined>>,
    Assert<Equal<keyof CommittedListPage, 'page' | 'totalObserved' | 'scanHead' | 'indexChanges'>>,
    Assert<Equal<CommittedListPage['scanHead'], FrozenPageEvidence | undefined>>,
    Assert<Equal<ListEnd, 'source_end' | 'provider_limit' | 'max_pages' | 'stopped'>>,
    Assert<Equal<Parameters<AIProvider['listConversations']>[0], ProviderListOptions>>,
    Assert<Equal<ReturnType<AIProvider['listConversations']>, Promise<ListEnd>>>,
    Assert<Equal<Parameters<AIProvider['checkReadiness']>[0], Account['id']>>,
    Assert<Equal<ReturnType<AIProvider['checkReadiness']>, Promise<ProviderReadiness>>>,
    Assert<Equal<Parameters<AIProvider['fetchConversationDetail']>[0], Account['id']>>,
    Assert<Equal<Parameters<AIProvider['fetchConversationDetail']>[1], ConversationKey['conversationId']>>,
    Assert<Equal<ReturnType<AIProvider['fetchConversationDetail']>, Promise<void>>>,
    Assert<Equal<Parameters<AIProvider['acquireResource']>[0], ConversationKey>>,
    Assert<Equal<Parameters<AIProvider['acquireResource']>[1], DomainAsset>>,
    Assert<Equal<ReturnType<AIProvider['acquireResource']>, Promise<ResourceBytes>>>,
    Assert<Equal<keyof GeminiNetworkBatchexecutePayload,
        'text' | 'url' | 'slot' | 'requestedAt' | 'truncated' | 'requestAccountObservation' | 'listRequest' | 'detailRequest'>>,
    Assert<Equal<GeminiNetworkBatchexecutePayload['detailRequest'],
        { conversationId: ConversationKey['conversationId']; requestCursor: string | null } | undefined>>,
    Assert<Equal<Parameters<ParseTakeoutArchive>[0], GeminiTakeoutZipRaw>>,
    Assert<Equal<ReturnType<ParseTakeoutArchive>, Promise<GeminiTakeoutParseResult[]>>>,
    Assert<Equal<Parameters<ParseOpenAIArchive>[0], Blob | Uint8Array>>,
    Assert<Equal<Parameters<ParseOpenAIArchive>[1], string>>,
];
const verified: Contract = [
    true, true, true, true, true, true, true, true,
    true, true, true, true, true, true, true, true,
    true, true, true, true, true, true, true,
];

type ConcreteClientContract = [
    Assert<Equal<Parameters<GeminiProvider['checkReadiness']>[0], Account['id']>>,
    Assert<Equal<Parameters<GeminiProvider['fetchConversationDetail']>[1], ConversationKey['conversationId']>>,
    Assert<Equal<Parameters<ChatGPTProvider['checkReadiness']>[0], Account['id']>>,
    Assert<Equal<Parameters<ChatGPTProvider['fetchConversationDetail']>[1], ConversationKey['conversationId']>>,
];
const concreteVerified: ConcreteClientContract = [true, true, true, true];

test('L1 exposed Client, Sniffer and Takeout types match frozen public contracts', () => {
    assert.equal(verified.length, 23);
    assert.ok(verified.every(Boolean) && concreteVerified.every(Boolean));
});
});

__suiteDescribe("provider_contract", () => {
type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Contracts = [
    Assert<Equal<ReturnType<AIProvider['listConversations']>, Promise<ListEnd>>>,
    Assert<Equal<ReturnType<AIProvider['fetchConversationDetail']>, Promise<void>>>,
    Assert<Equal<keyof ProviderListOptions, 'accountId' | 'streamId' | 'signal' | 'onPageCommitted' | 'onDiagnostic'>>,
    Assert<Equal<keyof CommittedListPage, 'page' | 'totalObserved' | 'scanHead' | 'indexChanges'>>,
    Assert<'key' extends keyof SourceConversationParseResult['conversation']['index'] ? false : true>,
    Assert<'key' extends keyof SourceConversationParseResult['conversation']['detail'] ? false : true>,
    Assert<GeminiProvider extends AIProvider ? true : false>,
];
const contracts: Contracts = [true, true, true, true, true, true, true];
test('provider contract exposes control results and keyless pure source candidates', () => assert.ok(contracts.every(Boolean)));
test('provider registry accepts the thin neutral API without a Gemini companion', async () => {
    const registry = new ProviderRegistryClass();
    const provider: AIProvider = { id: 'other', name: 'Other', hostPatterns: [], matchesUrl: () => true,
        checkReadiness: async () => ({ ready: true }), listConversations: async () => 'source_end',
        fetchConversationDetail: async () => {}, acquireResource: async () => ({ bytes: Uint8Array.of(1) }) };
    registry.register(provider);
    assert.equal(registry.get('other'), provider);
    assert.equal(await provider.listConversations({ accountId: 'uuid', streamId: 'recent' }), 'source_end');
});
test('Index normalization needs no Registry UUID and uses semantic title sources', () => {
    assert.deepEqual(parseGeminiIndexObservation({ id: 'c_source123', title: 'Source title', titleSource: 'rpc' }, 'rpc-list'),
        { conversationId: 'source123', fields: { title: 'Source title', titleSource: 'provider' } });
    assert.deepEqual(parseGeminiIndexObservation({ id: 'source123' }, 'dom'), { conversationId: 'source123', fields: {} });
});
test('RPC source parsing creates no local Key or Account', () => {
    const wire = geminiRpcPacket('detail').responseBody;
    const parsed = parseGeminiRpcConversation(wire, { providerId: 'gemini' });
    assert.equal(parsed.conversationId, GEMINI_DETAIL_CAPTURE.conversationId);
    assert.equal('account' in parsed, false);
    assert.equal('key' in parsed.conversation.index, false);
    assert.equal('key' in parsed.conversation.detail, false);
    assert.equal(parsed.conversation.detail.savedAt, undefined);
    assert.equal(parsed.conversation.detail.quality.status, 'unknown');
});
test('Takeout pure HTML parser produces the same keyless candidates without ZIP IO', () => {
    const htmlText = '<div class="outer-cell"><a href="https://gemini.google.com/app/source123">Conversation</a><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Prompted Question<br>2026-09-02T12:00:00Z<br><p>Answer</p></div></div>';
    const [parsed] = parseGeminiTakeoutArchive({ htmlText }, { providerId: 'gemini' });
    assert.equal(parsed.conversationId, 'source123');
    assert.equal(parsed.conversation.index.titleSource, 'derived');
    assert.equal('account' in parsed, false);
    assert.equal('key' in parsed.conversation.index, false);
    assert.equal(parsed.conversation.detail.quality.status, 'partial');
});
});

__suiteDescribe("provider_degrade", () => {
/**
 * tests/provider_degrade.test.ts
 * Source scripts are dynamically registered only after optional site access.
 */







test('Phase E: content-script matches are scoped to explicit HTTPS provider hosts', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    assert__s3.deepEqual(manifest.content_scripts ?? [], [], 'no platform is injected before permission');
    const patterns = Object.values(PLATFORM_HOSTS).flatMap(group => [...group.pages]);
    for (const pattern of patterns) {
        assert__s3.match(pattern, /^https:\/\/[a-z0-9.-]+\/\*$/i, `not a narrowly scoped HTTPS host: ${pattern}`);
        assert__s3.ok(!pattern.includes('*.'), `wildcard host is too broad: ${pattern}`);
    }
    assert__s3.ok(patterns.includes('https://gemini.google.com/*'), 'Gemini remains supported');
    // Other explicitly supported providers may be added without rewriting this test.
});
});

__suiteDescribe("retry_utils", () => {
const SRC = (p: string) => fs__s4.readFileSync(path__s4.join(__dirname, '..', p), 'utf8');


test('retryPolicy - interruptibleSleep delegates to abortableSleep when isAborted is omitted', async (t: TestContext) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fullPromise = interruptibleSleep(5000);
        t.mock.timers.tick(5000);
        const full = await fullPromise;
        assert.strictEqual(full, false, 'unaborted resolves false');

        const controller = new AbortController();
        const cutPromise = interruptibleSleep(5000, controller.signal);
        t.mock.timers.tick(100);
        controller.abort();
        const cut = await cutPromise;
        assert.strictEqual(cut, true, 'aborted resolves true');
    } finally {
        t.mock.timers.reset();
    }
});

test('retryPolicy - interruptibleSleep polling handles custom isAborted predicate', async (t: TestContext) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    try {
        let abortedFlag = true;
        const resInit = await interruptibleSleep(5000, undefined, () => abortedFlag);
        assert.strictEqual(resInit, true, 'initially aborted returns true');

        abortedFlag = false;
        const pPoll = interruptibleSleep(5000, undefined, () => abortedFlag);
        t.mock.timers.tick(50);
        abortedFlag = true;
        t.mock.timers.tick(50);
        const resPoll = await pPoll;
        assert.strictEqual(resPoll, true, 'polling aborted returns true');

        abortedFlag = false;
        const pNormal = interruptibleSleep(5000, undefined, () => abortedFlag);
        t.mock.timers.tick(5000);
        const resNormal = await pNormal;
        assert.strictEqual(resNormal, false, 'non-aborted predicate resolves false');
    } finally {
        t.mock.timers.reset();
    }
});

test('retryPolicy - handleHttp429 honors Retry-After header and backoff options', async (t: TestContext) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const resPromise = handleHttp429({
            resp: {
                status: 429,
                headers: { get: (h: string) => (h === 'retry-after' ? '1' : null) }
            },
            retryCount: 0,
            maxRetries: 3,
            label: 'test-429'
        });
        t.mock.timers.tick(35000);
        const res = await resPromise;
        assert.strictEqual(res.shouldRetry, true);
        assert.strictEqual(res.nextRetryCount, 1);
        assert.ok(typeof res.delayMs === 'number' && res.delayMs >= 2000, `delayMs >= 2000 (was ${res.delayMs})`);
    } finally {
        t.mock.timers.reset();
    }
});





test('architecture - retryPolicy.ts does not import export engine or rateLimiter', () => {
    const src = SRC('src/l1/client/gemini/api/retryPolicy.ts');
    assert.ok(!/from\s+['"][^'"]*engine/i.test(src), 'retryPolicy must not import from engine');
    assert.ok(!/from\s+['"][^'"]*rateLimiter/i.test(src), 'retryPolicy must not import rateLimiter');
    assert.ok(src.includes('retryUtils'), 'retryPolicy imports from retryUtils');
});
});
