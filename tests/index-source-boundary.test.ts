import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLegacyConversationIndex } from '../src/core/parsers/legacyStorage/parseIndex.js';
import { parseGeminiIndexObservation } from '../src/core/parsers/gemini/parseIndexObservation.js';

test('historical aliases cannot become current Gemini metadata or cloud evidence', () => {
    const raw = { id: 'c_boundary123', title: 'Current title', titleSource: 'dom',
        titles: { rpc: 'Historical authoritative title', takeout: 'Historical offline title' },
        timestamp: '1700000000', chatTime: 1700000010000, lastSeen: 1900000000000,
        href: 'https://example.com/historical', source: 'takeout-import', isTakeoutOnly: true,
        cloudAvailability: 'available', messageCount: 6 };
    const legacy = parseLegacyConversationIndex(raw);
    assert.equal(legacy.title, 'Historical authoritative title');
    assert.equal(legacy.titleSource, 'rpc');
    assert.equal(legacy.updatedAt, 1700000000000);
    assert.equal(legacy.url, raw.href);
    assert.equal(legacy.hasTakeoutImport, true);
    assert.equal(legacy.messageCount, undefined);

    const current = parseGeminiIndexObservation(raw, 'dom');
    assert.equal(current.title, 'Current title');
    assert.equal(current.titleSource, 'dom');
    assert.equal(current.updatedAt, undefined);
    assert.equal(current.url, 'https://gemini.google.com/app/boundary123');
    assert.equal(current.hasTakeoutImport, false);
    assert.equal(current.cloudAvailability, 'unknown');
    assert.equal(current.messageCount, 6);
    assert.equal(parseGeminiIndexObservation(raw, 'rpc-list').messageCount, undefined);
});

test('current metadata treats numeric strings as milliseconds without historical seconds inference', () => {
    const raw = { id: 'time-boundary', title: 'Title', updatedAt: '1700000000', createdAt: '1700000000' };
    assert.equal(parseLegacyConversationIndex(raw).updatedAt, 1700000000000);
    const current = parseGeminiIndexObservation(raw, 'dom');
    assert.equal(current.updatedAt, 1700000000);
    assert.equal(current.createdAt, 1700000000);
    assert.throws(() => parseGeminiIndexObservation({ id: 123 }, 'dom'), TypeError);
});
