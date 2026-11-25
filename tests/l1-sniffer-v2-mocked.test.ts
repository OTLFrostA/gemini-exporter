import { describe as __suiteDescribe } from 'node:test';
import { parseGeminiRequest } from "../src/l1/parsers/gemini/rpc/request.js";
import { geminiListPage } from "./fixtures/providers/geminiListCapture.js";
import { GEMINI_LIST_CAPTURE } from "./fixtures/providers/geminiListCapture.js";
import test from "node:test";
import { beforeEach } from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import { ports } from "./helpers/l1V2UnitMocks.js";
import { GEMINI_ACCOUNT } from "./helpers/l1V2UnitMocks.js";
import { init } from "../src/l1/sniffer/gemini/messageBridge.js";
import { handleWindowMessage } from "../src/l1/sniffer/gemini/messageBridge.js";
import { CrossWorldEvents } from "../src/l1/protocol/gemini/protocol.js";
import { createSourceResourceContext } from "../src/l1/resources/sourceResources.js";
import { listGen as geminiListGen } from "./fixtures/providers/gemini.js";
import { detailGen as geminiDetailGen } from "./fixtures/providers/geminiDetail.js";
import { deleteGen } from "./fixtures/providers/geminiDelete.js";
import { deleteRequestGen } from "./fixtures/providers/geminiDeleteRequest.js";
import { requestGen as geminiListRequestGen } from "./fixtures/providers/geminiListRequest.js";
import { parseList } from "../src/l1/parsers/gemini/rpc/parseList.js";
import { geminiListObservation } from "../src/l1/client/gemini/listObservation.js";

__suiteDescribe("l1-sniffer-v2-mocked", () => {
const origin = 'https://gemini.google.com';
const url = origin + '/_/BardChatUi/data/batchexecute';
const subject = { providerId: 'gemini', providerAccountId: GEMINI_ACCOUNT.providerAccountId };
const chat = 'source_sniff_123';
function event(type: string, payload: Record<string, unknown>): MessageEvent {
    return { source: globalThis.window, origin, data: { type, payload } } as unknown as MessageEvent;
}
function captured(text: string, extra: Record<string, unknown> = {}) {
    return event(CrossWorldEvents.NETWORK_BATCHEXECUTE, {
        text, slot: 'u0', requestedAt: 1700000000000, truncated: false,
        url, requestAccountObservation: subject, ...extra,
    });
}
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener() {}, removeEventListener() {},
} });
Object.defineProperty(globalThis, 'location', { configurable: true, value: {
    origin, hostname: 'gemini.google.com', pathname: '/app/' + chat, href: origin + '/app/' + chat,
} });
beforeEach(() => { ports.reset(); init(); });
after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation);
    else Reflect.deleteProperty(globalThis, 'location');
});

test('Sniffer submits list facts and request-bound page evidence without Application or Storage', async () => {
    const callbacks: string[] = [];
    ports.beforeIndexCommit = () => { callbacks.push('committed'); };
    init({ onIndexesCommitted: () => { callbacks.push('notified'); } });
    await handleWindowMessage(captured(geminiListPage().responseBody, {
        listRequest: { streamId: 'recent', requestCursor: null },
    }));
    assert.deepEqual(callbacks, ['committed', 'notified']);
    assert.equal(ports.indexes.length, 1);
    assert.equal(ports.indexes[0].accountId, GEMINI_ACCOUNT.id);
    assert.equal(ports.indexes[0].items.length, GEMINI_LIST_CAPTURE.firstPageRows);
    assert.equal(ports.indexes[0].items[0].conversationId, GEMINI_LIST_CAPTURE.first.id);
    assert.equal(ports.indexes[0].page?.requestKnown, true);
    assert.equal(ports.indexes[0].page?.valid, true);
    assert.equal(ports.indexes[0].page?.ordered, true);
    assert.equal(ports.indexes[0].page?.nextCursor, parseGeminiRequest(geminiListPage(1).requestBody).list!.requestCursor);
    assert.equal(ports.indexes[0].page?.keys.length, GEMINI_LIST_CAPTURE.firstPageRows);
    assert.deepEqual(ports.indexes[0].page?.keys[0], { id: GEMINI_LIST_CAPTURE.first.id, time: GEMINI_LIST_CAPTURE.first.updatedAt });
});

test('Sniffer accepts identifiable Index without falsely trusting unknown captured account/cursor', async () => {
    await handleWindowMessage(captured(geminiListPage().responseBody, {
        requestAccountObservation: null, listRequest: { streamId: 'recent', requestCursor: null },
    }));
    assert.equal(ports.indexes.length, 1);
    assert.equal(ports.indexes[0].accountId, GEMINI_ACCOUNT.id);
    assert.equal(ports.indexes[0].page, undefined, 'fallback to real A is not verified Gaia evidence');
    ports.reset();
    await handleWindowMessage(captured(geminiListPage().responseBody, { listRequest: undefined }));
    assert.equal(ports.indexes.length, 1);
    assert.equal(ports.indexes[0].page, undefined, 'no request cursor means no Coverage evidence');
});

test('Sniffer does not request an Account for unrecognized, empty or invalid unknown captures', async () => {
    await handleWindowMessage(captured('[]', { requestAccountObservation: null }));
    await handleWindowMessage(captured(geminiListGen('G_SNIFFER_LIST_04'), { requestAccountObservation: null }));
    await handleWindowMessage(captured(geminiListPage().responseBody, {
        requestAccountObservation: null, url: 'https://wrong.example.com/batchexecute',
    }));
    assert.deepEqual(ports.lookups, []);
    assert.deepEqual(ports.indexes, []);
});

test('Sniffer accepted/changed has exactly three distinct v2 effects', async () => {
    const events: string[] = [];
    const resources = createSourceResourceContext();
    const original = resources.retainParsed.bind(resources);
    resources.retainParsed = (key, parsed) => {
        events.push('resources:' + key.conversationId);
        original(key, parsed);
    };
    init({ resources, onDetailChanged: key => events.push('changed:' + key.conversationId) });
    const observed = captured(geminiDetailGen('G_SNIFFER_DETAIL_01'), {
        detailRequest: { conversationId: chat, requestCursor: null },
    });
    try {
        ports.detailDecision = { accepted: false, changed: false };
        await handleWindowMessage(observed);
        assert.deepEqual(events, []);
        assert.equal(ports.details.length, 1);
        assert.equal(ports.details[0].conversationId, chat);
        assert.ok(['complete', 'unknown', 'partial'].includes(ports.details[0].detail.quality.status));

        ports.detailDecision = { accepted: true, changed: false };
        await handleWindowMessage(observed);
        assert.deepEqual(events, ['resources:' + chat]);

        ports.detailDecision = { accepted: true, changed: true };
        await handleWindowMessage(observed);
        assert.deepEqual(events, ['resources:' + chat, 'resources:' + chat, 'changed:' + chat]);
        assert.equal(ports.details.length, 3);
    } finally { resources.release(); }
});

test('Sniffer does not retain resources or announce Live Save before Detail commit succeeds', async () => {
    const events: string[] = [];
    const resources = createSourceResourceContext();
    resources.retainParsed = () => { events.push('retained'); };
    init({ resources, onDetailChanged: () => { events.push('changed'); } });
    ports.detailError = new Error('mock L2 transaction rejected');
    try {
        await assert.rejects(handleWindowMessage(captured(geminiDetailGen('G_SNIFFER_DETAIL_02'), {
            detailRequest: { conversationId: chat, requestCursor: null },
        })), /mock L2 transaction rejected/);
        assert.deepEqual(events, []);
        assert.equal(ports.details.length, 0);
    } finally { resources.release(); }
});

test('Sniffer never performs active requests to supplement an uncorrelated or unfinished Detail', async () => {
    await handleWindowMessage(captured(geminiDetailGen('G_SNIFFER_DETAIL_03')));
    assert.equal(ports.details.length, 1);
    assert.equal(ports.details[0].detail.quality.status, 'unknown');
    assert.equal(ports.deletions.length, 0);
    assert.equal(ports.indexes.length, 0);
});

test('only a request-bound, positively confirmed deletion is handed to L2 once', async () => {
    const id = 'deadbeef00112233';
    const requestBody = deleteRequestGen('G_DELETE_SNIFFER_REQUEST_01');
    const responseText = deleteGen('G_DELETE_SNIFFER_RESPONSE_01');
    const done: string[] = [];
    init({ onConversationDeleted: () => done.push('notified') });
    const deleted = event(CrossWorldEvents.CONVERSATION_DELETED, {
        slot: 'u0', id, url, requestAccountObservation: subject, requestBody, responseText,
    });
    ports.beforeDeletionCommit = () => { done.push('committed'); };
    await handleWindowMessage(deleted);
    assert.deepEqual(ports.deletions, [[GEMINI_ACCOUNT.id, id]]);
    assert.deepEqual(done, ['committed', 'notified']);
    ports.reset();
    await handleWindowMessage(event(CrossWorldEvents.CONVERSATION_DELETED, {
        slot: 'u0', id, url, requestAccountObservation: subject, requestBody, responseText: deleteGen('G_DELETE_SNIFFER_RESPONSE_02'),
    }));
    assert.deepEqual(ports.deletions, [], 'outgoing DELETE alone is never a confirmation');
});
});

__suiteDescribe("page_observation", () => {
test('active and passive normalization retain identical independent cursor and ordering evidence', () => {
    for (const streamId of ['recent', 'pinned'] as const) {
        const result = parseList(geminiListPage().responseBody);
        const request = parseGeminiRequest(geminiListRequestGen(streamId === 'recent' ? 'G_PAGE_OBSERVATION_02_RECENT' : 'G_PAGE_OBSERVATION_02_PINNED')).list;
        assert.deepEqual(request, { streamId, requestCursor: 'incoming' });
        const observation = geminiListObservation(result, request, 'account');
        assert.equal(observation.providerId, 'gemini');
        assert.equal(observation.accountId, 'account');
        assert.equal(observation.streamId, streamId);
        assert.equal(observation.requestKnown, true);
        assert.equal(observation.requestCursor, 'incoming');
        assert.equal(observation.nextCursor, parseGeminiRequest(geminiListPage(1).requestBody).list!.requestCursor);
        assert.equal(observation.valid, true);
        assert.equal(observation.keys.length, GEMINI_LIST_CAPTURE.firstPageRows);
        assert.deepEqual(observation.keys[0], { id: GEMINI_LIST_CAPTURE.first.id, time: GEMINI_LIST_CAPTURE.first.updatedAt });
        assert.equal(observation.ordered, streamId === 'recent');
    }
});
test('fallback timestamps, rising times, malformed or truncated responses cannot certify ordering', () => {
    const request = { streamId: 'recent' as const, requestCursor: null };
    assert.equal(geminiListObservation(parseList(geminiListGen('G_PAGE_OBSERVATION_03')), request, 'account').ordered, false);
    const parsed = parseList(geminiListGen('G_PAGE_OBSERVATION_04'));
    assert.equal(geminiListObservation(parsed, request, 'account').ordered, false);
    assert.equal(geminiListObservation(parsed, request, 'account', true).valid, false);
    assert.equal(geminiListObservation(parsed, null, 'account').requestKnown, false);
    assert.equal(parseGeminiRequest(geminiListRequestGen('G_PAGE_OBSERVATION_05')).list, null);
});

test('captured empty Gemini list payload [] is valid exhaustion, while unknown nonempty shapes are not', () => {
    const empty = parseList(geminiListGen('G_PAGE_OBSERVATION_06'));
    assert.equal(geminiListObservation(empty, { streamId: 'pinned', requestCursor: null }, 'account').valid, true);
    assert.equal(geminiListObservation(empty, { streamId: 'recent', requestCursor: null }, 'account').ordered, true);
    assert.equal(geminiListObservation(parseList(geminiListGen('G_PAGE_OBSERVATION_07')), { streamId: 'recent', requestCursor: null }, 'account').valid, false);
});

test('different conversations with equal official timestamps retain ordering evidence', () => {
    const request = { streamId: 'recent' as const, requestCursor: null };
    const parsed = parseList(geminiListGen('G_PAGE_OBSERVATION_08'));
    const observation = geminiListObservation(parsed, request, 'account');
    assert.equal(observation.valid, true);
    assert.equal(observation.ordered, true);
    assert.equal(observation.keys[0].time, observation.keys[1].time);
    assert.equal(geminiListObservation(parseList(geminiListGen('G_PAGE_OBSERVATION_09')), request, 'account').ordered, true);
    const duplicate = geminiListObservation(parseList(geminiListGen('G_PAGE_OBSERVATION_10')), request, 'account');
    assert.equal(duplicate.valid, false);
    assert.equal(duplicate.ordered, false);
});

test('captured expanded webpage recent filter establishes request identity without accepting arbitrary layouts', () => {
    const valid = geminiListRequestGen('G_PAGE_OBSERVATION_11_VALID');
    assert.deepEqual(parseGeminiRequest(valid).list, { streamId: 'recent', requestCursor: null });
    for (const key of ['G_PAGE_OBSERVATION_11_INVALID_0', 'G_PAGE_OBSERVATION_11_INVALID_1',
        'G_PAGE_OBSERVATION_11_INVALID_2'] as const) {
        const request = geminiListRequestGen(key);
        assert.equal(parseGeminiRequest(request).list, null);
    }
});

test('list coverage uses the parser failure outcome, never the diagnostic payload', () => {
    const result = parseList(geminiListPage().responseBody);
    const request = { streamId: 'recent' as const, requestCursor: null };
    const debug = { error: 'NO_INNER_STR' as const, bardError: null, textLen: 3, rawPreview: 'bad', topParsed: null };
    assert.deepEqual(geminiListObservation({ ...result, _debug: debug }, request, 'account'),
        geminiListObservation(result, request, 'account'));
    assert.equal(geminiListObservation({ ...result, failure: 'invalid_response' }, request, 'account').valid, false);
});
});
