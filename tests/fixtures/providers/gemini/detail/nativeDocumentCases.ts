import { citationField, citationText } from './content.js';
import { DOMAIN_ID, dualAuditWire, rpc } from './protocol.js';

// Sanitized document shapes observed in the 2.1.1 diagnostic batch, plus
// counterexamples. These are authored inputs, not saved private RPC replies.
const body = () => [citationText('Known body.')];
const fallback = (document: unknown): string => dualAuditWire('Known body.', document);

function trailerMatrix(): string {
    const turns: unknown[] = [];
    for (const count of [1, 2, 3, 14, 25]) for (const flag of [0, 1, 2, 7, 128]) {
        const text = Array.from({ length: count }, (_, index) => `Paragraph ${index}.`);
        const model: unknown[] = [[['rc_trailer', [[text.join('\n\n')]]]]];
        model[12] = [[text.map(value => citationText(value)), [null, null, null, null, flag]]];
        turns.push([[DOMAIN_ID, `r_trailer_${turns.length}`], [1700000000 + turns.length, 0], [['Question']], model]);
    }
    // Native Detail replies list the newest turn first.
    return rpc([turns.reverse()]);
}

export const nativeDocumentCases = {
    'G_NATIVE_DOCUMENT_EMPTY_QUOTES': () => dualAuditWire('Before.\n\nAfter.', [[[
        citationText('Before.'), citationField(16, []), citationField(16, [[]]), citationText('After.'),
    ]]]),
    'G_NATIVE_DOCUMENT_STRIKETHROUGH': () => dualAuditWire('Keep ~~old~~ new.', [[[
        citationText('Keep old new.', [[5, 8, [[null, null, null, null, 4]]]]),
    ]]]),
    'G_NATIVE_DOCUMENT_TRAILER_MATRIX': () => trailerMatrix(),
    'G_NATIVE_DOCUMENT_SECOND_BODY': () => fallback([[body(), [citationText('Second body.')]]]),
    'G_NATIVE_DOCUMENT_TRAILER_CONTENT': () => fallback([[body(), [null, null, 'authored text', null, 1]]]),
    'G_NATIVE_DOCUMENT_TRAILER_UNKNOWN_FLAG': () => fallback([[body(), [null, null, null, null, 'unknown']]]),
    'G_NATIVE_DOCUMENT_TRAILER_NEGATIVE_FLAG': () => fallback([[body(), [null, null, null, null, -1]]]),
    'G_NATIVE_DOCUMENT_MULTIPLE_BRANCHES': () => fallback([[body()], [body()]]),
    'G_NATIVE_DOCUMENT_UNKNOWN_CHILD': () => fallback([[
        [...body(), citationField(38, ['unknown'])], [null, null, null, null, 1],
    ]]),
};
