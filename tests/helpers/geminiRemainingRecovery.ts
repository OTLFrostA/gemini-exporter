import assert from 'node:assert/strict';
import { detailGen } from '../fixtures/providers/geminiDetail.js';
import { fixtureAccount, fixtureKey } from './domainFixture.js';
import { parseGeminiRpcConversation } from '../../src/l1/parsers/gemini/rpc/parseConversation.js';
import { mergeConversationPages } from '../../src/l1/parsers/gemini/rpc/mergePages.js';
import { validateParserDomain } from '../../src/l2/runtimeValidation.js';
import { composeDomainDocument } from '../../src/l3b/compose/composeDomainDocument.js';
import { renderDocumentMarkdown } from '../../src/l4/format/markdown/renderMarkdown.js';
import { mapContentAssetReferences } from '../../src/l2/content/assetReferences.js';

interface RecoveryExpectation {
    key: Parameters<typeof detailGen>[0];
    visible: readonly string[];
    links: readonly string[];
    ordered?: readonly string[];
    image?: string;
    linkedLabels?: ReadonlyArray<readonly [string, string]>;
    surrounded?: false;
}

// Independently authored output requirements, never produced by a decoder.
// Only unambiguous visible fields are specified. This is a minimum recovery
// contract, not proof that every field of the original widget is represented.
export const remainingRecoveryExpectations: readonly RecoveryExpectation[] = [
    { key: 'G_REMAINING_PLAN', visible: ['Fixture research plan', 'Find evidence', 'Read the fixture sources.', 'Compare results', 'Write report'],
        links: ['https://example.com/research'], ordered: ['Find evidence', 'Read the fixture sources.', 'Compare results', 'Write report'] },
    { key: 'G_REMAINING_DOCUMENT_1', visible: ['Fixture document'], links: ['https://example.com/document'] },
    { key: 'G_REMAINING_DOCUMENT_2', visible: ['Fixture document'], links: ['https://example.com/document'] },
    { key: 'G_REMAINING_DOCUMENT_3', visible: ['Fixture document'], links: ['https://example.com/document'] },
    { key: 'G_REMAINING_DOCUMENT_MULTIPLE', visible: ['First fixture document', 'Second fixture document'],
        links: ['https://example.com/first-document', 'https://example.com/second-document'],
        ordered: ['First fixture document', 'Second fixture document'], linkedLabels: [
            ['First fixture document', 'https://example.com/first-document'],
            ['Second fixture document', 'https://example.com/second-document'],
        ] },
    { key: 'G_REMAINING_MAP', visible: ['Fixture Museum', 'Fixture address'], links: ['https://example.com/museum'] },
    { key: 'G_REMAINING_MAP_MULTIPLE', visible: ['Fixture Museum', 'Fixture Park', 'Fixture address'],
        links: ['https://example.com/museum', 'https://example.com/park'], ordered: ['Fixture Museum', 'Fixture Park'],
        linkedLabels: [['Fixture Museum', 'https://example.com/museum'], ['Fixture Park', 'https://example.com/park']] },
    { key: 'G_REMAINING_FLIGHTS', visible: ['AAA', 'BBB', 'FX', 'FY', '10:00', '12:00', 'USD 120', 'unavailable'],
        links: ['https://example.com/flight-one', 'https://example.com/flight-two'] },
    { key: 'G_REMAINING_GMAIL', visible: ['Fixture mail subject', 'Fixture mail summary', 'Fixture mail preview', 'Fixture mail body.', 'Fixture sender'],
        links: ['https://example.com/mail'] },
    { key: 'G_REMAINING_FINANCE', visible: ['Fixture stock price is 12.50 USD.'],
        links: ['https://example.com/stock', 'https://example.com/disclaimer'] },
    { key: 'G_REMAINING_ATTACHMENT', visible: [], links: [], image: 'https://example.com/image.jpg' },
    { key: 'G_REMAINING_BUSINESSES', visible: ['Fixture Cafe', 'Fixture Bakery', '4.2', '4.4', 'Open', 'Closed'],
        links: ['https://example.com/cafe', 'https://example.com/bakery'], ordered: ['Fixture Cafe', 'Fixture Bakery'] },
    { key: 'G_REMAINING_EMPTY', visible: ['Body after empty node.'], links: [] },
    { key: 'G_REMAINING_NESTED_EMPTY', visible: ['Body after empty node.'], links: [] },
    { key: 'G_REMAINING_ANNOTATION_PLACE', visible: ['Fixture Museum'], links: ['https://example.com/place'], surrounded: false },
    { key: 'G_REMAINING_ANNOTATION_PLACE_HTTP', visible: ['Fixture Museum'], links: ['http://example.com/place'], surrounded: false },
    { key: 'G_REMAINING_MAP_API', visible: ['API Museum', 'API address', 'API description', '123-456', '4.6 (123)'],
        links: ['https://example.com/api-place', 'https://example.com/place-site', 'https://example.com/map-search'] },
    { key: 'G_REMAINING_GMAIL_PREVIEW', visible: ['Fixture mail subject', 'Fixture mail summary', 'Fixture mail preview', 'Fixture sender'],
        links: ['https://example.com/mail'] },
    { key: 'G_REMAINING_GMAIL_SUMMARY', visible: ['Fixture mail subject', 'Fixture mail summary', 'Fixture sender'],
        links: ['https://example.com/mail'] },
    { key: 'G_REMAINING_GMAIL_IMAGE', visible: ['Fixture mail subject', 'Fixture mail body.'], links: ['https://example.com/mail'],
        image: 'https://example.com/mail-image.png' },
    { key: 'G_REMAINING_PLACEHOLDER_MARKDOWN', visible: ['Authoritative Markdown body.'], links: [], surrounded: false },
    { key: 'G_REMAINING_ALTERNATIVE_FIRST', visible: ['Selected body.'], links: [], surrounded: false },
    { key: 'G_REMAINING_ALTERNATIVE_SECOND', visible: ['Selected body.'], links: [], surrounded: false },
];

export function parseRemainingFixture(key: Parameters<typeof detailGen>[0]) {
    const account = fixtureAccount('gemini');
    const page = parseGeminiRpcConversation(detailGen(key), { account, providerId: 'gemini' });
    const merged = mergeConversationPages([page], undefined, true);
    const domainKey = fixtureKey(merged.conversationId);
    const domain = validateParserDomain({ index: { ...merged.conversation.index, key: domainKey },
        detail: { ...merged.conversation.detail, key: domainKey } });
    return { merged, domain, markdown: renderDocumentMarkdown(composeDomainDocument(domain, account), {}) };
}

export function assertRemainingRecovery(expected: RecoveryExpectation, result = parseRemainingFixture(expected.key)): void {
    const { markdown, merged, domain } = result;
    for (const text of expected.visible) assert.ok(markdown.includes(text), `${expected.key}: missing visible content: ${text}`);
    for (const url of expected.links) assert.ok(markdown.includes('](' + url + ')'), `${expected.key}: missing clickable link: ${url}`);
    for (const [label, url] of expected.linkedLabels ?? []) {
        assert.ok(markdown.includes('[' + label + '](' + url + ')'), `${expected.key}: wrong label/URL binding: ${label}`);
    }
    let previous = -1;
    for (const text of expected.ordered ?? []) {
        const index = markdown.indexOf(text);
        assert.ok(index > previous, `${expected.key}: content order: ${text}`);
        previous = index;
    }
    if (expected.surrounded !== false && expected.key !== 'G_REMAINING_EMPTY' && expected.key !== 'G_REMAINING_NESTED_EMPTY') {
        const before = markdown.indexOf('Before card.'), after = markdown.indexOf('After card.');
        assert.ok(before >= 0 && after > before, `${expected.key}: surrounding paragraphs must survive`);
        for (const text of expected.visible) {
            assert.ok(markdown.indexOf(text) > before && markdown.indexOf(text) < after, `${expected.key}: card placement: ${text}`);
        }
    }
    if (expected.image) {
        const asset = domain.detail.assets.find(asset => asset.sourceUri === expected.image);
        assert.equal(asset?.kind, 'image', `${expected.key}: missing image resource`);
        let owned = false;
        for (const message of domain.detail.messages) {
            if (message.attachmentIds?.includes(asset?.id ?? '')) owned = true;
            mapContentAssetReferences(message.content, ref => {
                if (ref === asset?.id) owned = true;
                return ref;
            });
        }
        assert.ok(owned, 'image must belong to a message body or attachment');
    }
    assert.doesNotMatch(markdown, /opaque-|Fallback body remains available|File attachment was not previously registered/);
    assert.equal(merged.diagnostics.filter(d => d.code === 'GEMINI_STRUCTURED_FALLBACK' && d.severity === 'warning').length, 0,
        `${expected.key}: native recovery still falls back`);
    assert.equal(domain.detail.quality.status, 'complete', `${expected.key}: recovered body must be complete`);
}
