import { citationField, citationText, coverageWire } from './content.js';
import { invalidSourceRangeNodes, legalSourceRangeControls } from './remainingSourceRanges.js';
import type { GeminiTextNode } from '../../../../../src/l1/parsers/gemini/rpc/structuredContent.js';

// Authored, minimal reproductions of diagnostic shapes. These are not captured
// replies. Keep expected visible content outside the fixture factories.
const wire = (raw: unknown, sources?: unknown, markdown = 'Fallback body remains available.') => coverageWire(raw, [['rc_primary', [[markdown]], sources]]);
const body = (nodes: unknown[]) => wire([[[...nodes]]]);
const surrounding = (node: unknown) => wire([[[citationText('Before card.'), node, citationText('After card.')]]],
    undefined, 'Before card.\n\nFallback body remains available.\n\nAfter card.');

const plan = () => citationField(27, [[
    'Fixture research plan', [[1, 'Find evidence', 'Read the fixture sources.'], [2, 'Compare results'], [3, 'Write report']],
    'opaque-plan-id', ['Research summary'], ['https://example.com/research', 0],
    ['opaque-request-id', [null, null, null, 'opaque-control']],
]]);
const unsupportedSibling = (node: unknown[]) => Object.assign(node, { 38: ['Fixture unsupported body.'] });

function documentChip(kind: number): string {
    return surrounding(citationField(24, [[
        ['https://example.com/document'], 'opaque-document-id', kind === 3 ? 'document metadata' : null,
        'Fixture document', kind === 2 ? 'opaque-owner-id' : null,
        [1700000000, 0], kind === 2 ? true : null, kind,
    ]]));
}

function place(name: string, url: string): unknown[] {
    return [null, null, null, [name, 'Fixture address', null, null, null, null, null, null,
        'opaque-place-id', null, null, [1, 2], [[0, 1], [2, 3]], null, url,
        { 22: 540, 31: ['Town', 'Country'], 51: 'region', 88: ['timezone'] }],
    null, null, null, null, null, '', 'Place', [], null, null, null, null, null, null, [[1, 2, 3], [4, 5, 6]], 1];
}

function rangeWire(nodes: GeminiTextNode[]): string {
    const ids = new Set(nodes.flatMap(node => (node.annotations ?? []).flatMap(annotation =>
        annotation.type === 'source' ? annotation.sourceIds : [])));
    return wire({ children: nodes }, [null, [...ids].map(id => [
        ['Fixture cited span'], [1], [['https://example.com/' + id, 'Fixture source']], id,
    ])]);
}

function flight(code: string, url: string, price: string): unknown[] {
    return [[[code], url, 'AAA', 'BBB', null, null, 0, '10:00', '12:00', '2 hours'], null, url, price];
}

function gmailCard(): unknown[] {
    return citationField(30, [[
        ['https://example.com/mail', null, null, null, null, null,
            ['Mail', 'https://example.com/mail', 'https://example.com/icon', 'Mail account']],
        [[2, 0, 'opaque-request-id', 'opaque-thread-id', { 1144: [
            'opaque-message-id', null, null, ['Fixture mail preview', '', 'opaque-author-id'],
            [['<p>Fixture mail body.</p>', 'opaque-message-id', 'opaque-thread-id']], 2, false,
        ] }]], null, null, ['opaque-thread-id'],
        { 133: [null, null, [null, 'Fixture mail subject', 'Fixture mail summary', ['Fixture sender'], ['opaque-message-id']]] },
    ]]);
}

function financeCard(): unknown[] {
    const summary = 'Fixture stock price is 12.50 USD.';
    return citationField(8, [null, [
        ['https://example.com/stock', null, null, JSON.stringify({
            name: 'Fixture Company', symbol: 'FIX', currencyCode: 'USD', lastPrice: { value: 12.5 },
        })], null, null, summary, summary + ' [Disclaimer](https://example.com/disclaimer)', 'Fixture stock price',
    ], [[], []], summary + ' [Disclaimer](https://example.com/disclaimer)']);
}

function attachmentCard(): unknown[] {
    return citationField(9, [[[
        [null, null, null, [null, 1, 'fixture-image-tag', null,
            [3, null, 'File attachment was not previously registered'], null, null, null, null, null, null, 'image/jpeg']],
        ['https://example.com/image.jpg'], null,
        [0, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, false],
        null, null, null, null, null, null, null, [true],
    ]]]);
}

// Two annotation encodings and a rich-place annotation need separate evidence.
// An unbound cit_/sp_ identifier is deliberately not converted into an spp_ ID.
function referenceAnnotation(nested: boolean, zeroWidth = false): string {
    const text = 'Fixture reference';
    return body([citationText(text, [[0, zeroWidth ? 0 : text.length,
        [null, null, null, nested ? [[null, null, zeroWidth ? '0' : 'cit_fixture']] : [null, ['sp_fixture']]],
    ]])]);
}

function placeAnnotation(): string {
    const metadata = Object.assign(Array(35).fill(null), {
        10: 'opaque-place-id', 12: 'https://example.com/place', 13: 'Fixture Museum', 14: 'Fixture address',
        15: [], 16: 'Museum', 17: 23, 18: [['Town', 'Region', 'Country'], null, 'postcode'],
        19: 'category', 20: 'label', 22: ['https://example.com/place'],
        26: ['Maps', null, ['https://example.com/place', 'Fixture Museum', null, 'Maps', 'https://example.com/place'], 1],
        27: 'opaque-token', 31: 5, 32: [2, 1, 21], 33: true, 34: 'opaque-place-token',
    });
    return body([citationText('Fixture Museum', [[0, 14, [null, null, null, null, null,
        [null, null, null, null, null, null, [metadata, ['opaque-id', null, 1, ['Town', 'Region', 'Country']]]],
    ]]])]);
}

export const remainingFallbackCases = {
    'G_REMAINING_PLAN': () => surrounding(plan()),
    'G_REMAINING_DOCUMENT_1': () => documentChip(1),
    'G_REMAINING_DOCUMENT_2': () => documentChip(2),
    'G_REMAINING_DOCUMENT_3': () => documentChip(3),
    'G_REMAINING_DOCUMENT_MULTIPLE': () => surrounding(citationField(24, [
        [['https://example.com/first-document'], 'opaque-first-id', null, 'First fixture document', null, [1700000000, 0], null, 1],
        [['https://example.com/second-document'], 'opaque-second-id', 'metadata', 'Second fixture document', null, [1700000001, 0], null, 3],
    ])),
    'G_REMAINING_PLAN_UNKNOWN_SIBLING': () => surrounding(unsupportedSibling(plan())),
    'G_REMAINING_DOCUMENT_UNKNOWN_SIBLING': () => surrounding(unsupportedSibling(citationField(24, [
        [['https://example.com/document'], 'opaque-document-id', null, 'Fixture document', null, [1700000000, 0], null, 1],
    ]))),
    'G_REMAINING_MAP_UNKNOWN_SIBLING': () => surrounding(unsupportedSibling(citationField(6, [[], [[[
        place('Fixture Museum', 'https://example.com/museum'),
    ]]]]))),
    // The observed root contains two body sequences. The second is not a trailer.
    'G_REMAINING_BODY_SEQUENCES': () => wire([
        [[citationText('First body.')]], [[citationText('Second body.')]],
    ]),
    'G_REMAINING_BODY_SEQUENCES_LIST': () => wire([
        [[citationText('First body.')]], [[citationField(11, [[[[citationText('Second list item.')]]]])]],
    ]),
    'G_REMAINING_NESTED_EMPTY': () => body([[[]], citationText('Body after empty node.')]),
    'G_REMAINING_EMPTY': () => body([[], citationText('Body after empty node.')]),
    'G_REMAINING_MAP': () => surrounding(citationField(6, [[], [[[place('Fixture Museum', 'https://example.com/museum')]]]])),
    'G_REMAINING_MAP_MULTIPLE': () => surrounding(citationField(6, [[], [[[
        place('Fixture Museum', 'https://example.com/museum'), place('Fixture Park', 'https://example.com/park'),
    ]]]])),
    'G_REMAINING_FLIGHTS': () => surrounding(citationField(4, [[], [1, [
        flight('FX', 'https://example.com/flight-one', 'USD 120'),
        flight('FY', 'https://example.com/flight-two', 'unavailable'),
    ], 'https://example.com/flights', ['https://example.com/flights', null, 'Fixture flight search', null, null, null,
        ['Flights', 'https://example.com/flights', null, 'Flights']], 'Fixture Airport AAA', 'Fixture Airport BBB', 'Fixture date', null, '1 adult']])),
    'G_REMAINING_GMAIL': () => surrounding(gmailCard()),
    'G_REMAINING_FINANCE': () => surrounding(financeCard()),
    'G_REMAINING_ATTACHMENT': () => surrounding(attachmentCard()),
    'G_REMAINING_BUSINESSES': () => surrounding(citationField(5, [[], [[
        ['Fixture Cafe', ['https://example.com/cafe', 'https://example.com/photo'], 4.2, 12, 'Cafe', '', null, 'https://example.com/cafe', 'Open'],
        ['Fixture Bakery', ['https://example.com/bakery'], 4.4, 24, 'Bakery', 'Fixture address', null, 'https://example.com/bakery', 'Closed'],
    ], null, ['https://example.com/businesses', null, 'Fixture businesses', null, null, null,
        ['Maps', 'https://example.com/businesses', null, 'Places']], 'Fixture business search', 'Town', 'Country', null, null, 'Places']])),
    'G_REMAINING_ANNOTATION_NESTED': () => referenceAnnotation(true),
    'G_REMAINING_ANNOTATION_DIRECT': () => referenceAnnotation(false),
    'G_REMAINING_ANNOTATION_ZERO': () => referenceAnnotation(true, true),
    'G_REMAINING_ANNOTATION_PLACE': () => placeAnnotation(),
    'G_REMAINING_RANGES_INVALID': () => rangeWire(invalidSourceRangeNodes),
    'G_REMAINING_RANGES_LEGAL': () => rangeWire(legalSourceRangeControls),
};
