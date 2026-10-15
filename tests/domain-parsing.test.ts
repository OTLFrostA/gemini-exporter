import { historicalFixture } from './helpers/nativeFixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConversation } from '../src/core/parsers/parseConversation.js';
import { assertDomainClosure } from '../src/core/domain/closure.js';
import type { ConversationRecordInput } from '../src/core/parsers/legacyStorage/conversationRecord.js';
import type { ConversationParseResult } from '../src/core/parsers/contracts.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';

const parse = (data: ConversationRecordInput) => historicalFixture(data, { providerId: 'gemini' });

test('unified parsing requires explicit provider identity and implemented format', () => {
    const data = { source: 'openai-import', messages: [{ role: 'model', model: 'Model A', content: '**Answer**' }] };
    const result = historicalFixture(data, { providerId: 'custom' });
    assert.equal(result.conversation.index.providerId, 'custom');
    assert.equal(result.conversation.detail.messages[0].model, 'Model A');
    for (const providerId of ['', '  ']) {
        assert.throws(() => historicalFixture(data, { providerId: providerId as never }), /providerId/);
    }
    assert.throws(() => parseConversation({ format: 'raw-rpc' as never, providerId: 'gemini', data: data as never }), /Unsupported conversation format/);
});

test('historical record fixtures retain provider inference inside the migration boundary', () => {
    for (const source of ['takeout', 'openai-import']) {
        const data = { id: 'chat', title: 'Title', timestamp: null, source, messages: [{ role: 'assistant' as const, content: '**Answer**' }] };
        const providerId = source === 'takeout' ? 'gemini' : 'openai';
        const result = historicalFixture(data, { providerId });
        assert.deepEqual(historicalFixture(data, { providerId }), result);
        assert.deepEqual(historicalFixture(data), result);
        assert.deepEqual(data.messages[0].content, '**Answer**');
    }
});

test('source provenance and explicit completeness survive JSON without leaking transport state', () => {
    const data = { id: 'chat', source: 'takeout', completeness: { status: 'complete' as const }, nextPageToken: null,
        messages: [{ id: 'answer', role: 'model', model: 'Model A', providerRequestId: 'request', content: 'Answer' }] };
    const original = structuredClone(data);
    const { conversation } = parse(data);
    assert.equal(Reflect.get(conversation, 'provenance'), undefined);
    assert.equal(conversation.detail.completeness, 'complete');
    assert.deepEqual(JSON.parse(JSON.stringify(conversation)), conversation);
    assertDomainClosure((conversation).detail);
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
        assert.equal(conversation.detail.completeness, 'partial');
        assert.ok(!JSON.stringify(conversation).includes('opaque-cursor'));
        assert.deepEqual(data, original);
    }
});

test('absence of truncation is not evidence of complete coverage', () => {
    for (const data of [{}, { truncated: false, isTruncated: false, nextPageToken: null }, { nextPageToken: '  ', truncateReason: 'Unconfirmed' }]) {
        assert.equal(parse(data).conversation.detail.completeness, 'unknown');
    }
    assert.deepEqual(parse({ completeness: { status: 'unknown' } }).conversation.detail.completeness, 'unknown');
    assert.deepEqual(parse({ nextPageToken: 'cursor', completeness: { status: 'partial', reason: 'Selected range' } }).conversation.detail.completeness,
        'partial');
    assert.deepEqual(parse({ completeness: { status: 'partial', reason: 'Only a selected range' } }).conversation.detail.completeness,
        'partial');
});

test('Domain completeness is validated and copied independently from input evidence', () => {
    const data = { completeness: { status: 'partial' as const, reason: 'Missing older messages' } };
    const { conversation } = parse(data);
    conversation.detail.completeness = 'complete';
    assert.equal(data.completeness.reason, 'Missing older messages');
    assert.throws(() => parse({ completeness: { status: 'finished' as never } }), /completeness/);
    assert.equal(parse({ completeness: { status: 'partial', reason: 42 as never } }).conversation.detail.completeness, 'partial');
});

test('conversation timestamps cannot lose meaning during JSON serialization', () => {
    for (const timestamp of [NaN, Infinity, -Infinity, '123', undefined]) {
        const { conversation } = parse({ timestamp });
        assert.equal(Reflect.get(conversation, 'updatedAt'), undefined);
        assert.deepEqual(JSON.parse(JSON.stringify(conversation)), conversation);
    }
    for (const timestamp of [0, -1000, 1700000000123]) {
        const { conversation } = parse({ timestamp });
        assert.equal(Reflect.get(conversation, 'updatedAt'), undefined);
        assert.equal(Object.hasOwn(conversation, 'timestamp'), false);
    }
});

test('shared parse result keeps diagnostics and preparation evidence outside a closed Domain graph', () => {
    const data = { messages: [{ role: 'custom-role', content: '![picture](https://example.test/picture.png)',
        attachments: [{ localName: 'assets/archive.png', mimeType: 'image/png', url: 'https://example.test/picture.png' }] }] };
    const original = structuredClone(data);
    const result = parse(data);
    const semanticResult: ConversationParseResult = result;
    assert.ok(semanticResult.diagnostics.some(d => d.code === 'UNKNOWN_ROLE'));
    assert.equal(result.conversation.detail.assets.length, 1);
    assert.ok(Object.keys(result.resourceHints).includes(result.conversation.detail.assets[0].id));
    const json = JSON.stringify(result.conversation);
    for (const field of ['diagnostics', 'resourceHints', 'acquisitionHints', 'localName']) assert.ok(!json.includes(`"${field}":`));
    assertDomainClosure((JSON.parse(json)).detail);
    assert.deepEqual(data, original);
});
