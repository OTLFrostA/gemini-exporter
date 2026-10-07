import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConversation } from '../src/core/parsers/parseConversation.js';
import { parseProviderConversation } from '../src/core/compatibility/conversationParser.js';
import { parseLegacyConversation } from '../src/core/compatibility/legacyConversationAdapter.js';
import { assertDomainClosure } from '../src/core/domain/closure.js';
import type { ConversationRecordInput } from '../src/core/compatibility/record/conversationRecord.js';
import type { ConversationParseResult } from '../src/core/parsers/contracts.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';

const parse = (data: ConversationRecordInput) => parseConversation({ format: 'conversation-record', providerId: 'gemini', data });

test('unified parsing requires explicit provider identity and implemented format', () => {
    const data = { source: 'openai-import', messages: [{ role: 'model', model: 'Model A', content: '**Answer**' }] };
    const result = parseConversation({ format: 'conversation-record', providerId: 'custom', data });
    assert.equal(result.conversation.providerId, 'custom');
    assert.equal(result.conversation.messages[0].model, 'Model A');
    for (const providerId of ['', '  ', undefined, null]) {
        assert.throws(() => parseConversation({ format: 'conversation-record', data, providerId: providerId as never }), /providerId/);
    }
    assert.throws(() => parseConversation({ format: 'raw-rpc' as never, providerId: 'gemini', data }), /Unsupported conversation format/);
});

test('legacy application callers retain provider inference and use the unified Domain result', () => {
    for (const source of ['takeout', 'openai-import']) {
        const data = { id: 'chat', title: 'Title', timestamp: null, source, messages: [{ role: 'assistant' as const, content: '**Answer**' }] };
        const providerId = source === 'takeout' ? 'gemini' : 'openai';
        const result = parseConversation({ format: 'conversation-record', providerId, data });
        assert.deepEqual(parseProviderConversation(data), result);
        assert.deepEqual(parseLegacyConversation(data), { conversation: result.conversation, resourceHints: result.resourceHints });
        assert.deepEqual(data.messages[0].content, '**Answer**');
    }
});

test('source provenance and explicit completeness survive JSON without leaking transport state', () => {
    const data = { id: 'chat', source: 'takeout', completeness: { status: 'complete' as const }, nextPageToken: null,
        messages: [{ id: 'answer', role: 'model', model: 'Model A', providerRequestId: 'request', content: 'Answer' }] };
    const original = structuredClone(data);
    const { conversation } = parse(data);
    assert.deepEqual(conversation.provenance, { source: 'takeout' });
    assert.deepEqual(conversation.completeness, { status: 'complete' });
    assert.deepEqual(JSON.parse(JSON.stringify(conversation)), conversation);
    assertDomainClosure(conversation);
    assert.equal('nextPageToken' in conversation, false);
    assert.equal('source' in conversation, false);
    const document = composeDomainDocument(conversation).document;
    assert.equal(document.messages[0].modelLabel, 'Model A');
    assert.equal('provenance' in document, false);
    assert.equal('completeness' in document, false);
    assert.deepEqual(data, original);
});

test('positive truncation or paging evidence takes precedence over a complete claim', () => {
    for (const evidence of [{ truncated: true }, { isTruncated: true }, { nextPageToken: 'opaque-cursor' }]) {
        const data = { completeness: { status: 'complete' as const }, truncateReason: 'Source limit', ...evidence };
        const original = structuredClone(data);
        const { conversation } = parse(data);
        assert.deepEqual(conversation.completeness, { status: 'partial', reason: 'Source limit' });
        assert.ok(!JSON.stringify(conversation).includes('opaque-cursor'));
        assert.deepEqual(data, original);
    }
});

test('absence of truncation is not evidence of complete coverage', () => {
    for (const data of [{}, { truncated: false, isTruncated: false, nextPageToken: null }, { nextPageToken: '  ', truncateReason: 'Unconfirmed' }]) {
        assert.equal(parse(data).conversation.completeness, undefined);
    }
    assert.deepEqual(parse({ completeness: { status: 'unknown' } }).conversation.completeness, { status: 'unknown' });
    assert.deepEqual(parse({ nextPageToken: 'cursor', completeness: { status: 'partial', reason: 'Selected range' } }).conversation.completeness,
        { status: 'partial', reason: 'Selected range' });
    assert.deepEqual(parse({ completeness: { status: 'partial', reason: 'Only a selected range' } }).conversation.completeness,
        { status: 'partial', reason: 'Only a selected range' });
});

test('Domain completeness is validated and copied independently from input evidence', () => {
    const data = { completeness: { status: 'partial' as const, reason: 'Missing older messages' } };
    const { conversation } = parse(data);
    conversation.completeness!.reason = 'Changed by caller';
    assert.equal(data.completeness.reason, 'Missing older messages');
    assert.throws(() => parse({ completeness: { status: 'finished' as never } }), /completeness/);
    assert.throws(() => parse({ completeness: { status: 'partial', reason: 42 as never } }), /completeness/);
});

test('conversation timestamps cannot lose meaning during JSON serialization', () => {
    for (const timestamp of [NaN, Infinity, -Infinity, '123', undefined]) {
        const { conversation } = parse({ timestamp });
        assert.equal(conversation.timestamp, null);
        assert.deepEqual(JSON.parse(JSON.stringify(conversation)), conversation);
    }
    for (const timestamp of [0, -1000, 1700000000123]) {
        const { conversation } = parse({ timestamp });
        assert.equal(conversation.timestamp, timestamp);
        assert.throws(() => assertDomainClosure({ ...conversation, timestamp: NaN }), /timestamp/);
    }
});

test('shared parse result keeps diagnostics and preparation evidence outside a closed Domain graph', () => {
    const data = { messages: [{ role: 'custom-role', content: '![picture](https://example.test/picture.png)',
        attachments: [{ localName: 'assets/archive.png', mimeType: 'image/png', url: 'https://example.test/picture.png' }] }] };
    const original = structuredClone(data);
    const result = parse(data);
    const semanticResult: ConversationParseResult = result;
    assert.ok(semanticResult.diagnostics.some(d => d.code === 'UNKNOWN_ROLE'));
    assert.equal(result.conversation.assets.length, 1);
    assert.ok(Object.keys(result.resourceHints).includes(result.conversation.assets[0].id));
    const json = JSON.stringify(result.conversation);
    for (const field of ['diagnostics', 'resourceHints', 'acquisitionHints', 'localName']) assert.ok(!json.includes(`"${field}":`));
    assertDomainClosure(JSON.parse(json));
    assert.deepEqual(data, original);
});
