import { citationField, citationText } from './content.js';

// Sanitized protocol shapes from the 2.1.1 diagnostic batch. Source metadata
// and candidate field 44 remain correlated; no private source data is copied.
export const sourceUrl = 'https://example.com/source';
export const workspace = (extended: boolean): unknown[] => extended
    ? [[1], sourceUrl, 'Example source', ['source-id'], 'date', 'author', [1700000000], [], 'token',
        null, null, 4, null, null, null, ['author', 'https://example.com/avatar', '', 'id', '']]
    : [[1], sourceUrl, 'Example source'];
const file = (): unknown[] => [
    [null, 11, 'example.txt', null, null, 'file-id', null, [1, 2, 3], 1, [1, 2], null, 'text/plain'],
    null, null, null, 1, null, 'example.txt',
];
export const fileSource = (): unknown[] => [null, file(), 'Source excerpt', null, [[[[0, 5, 1, 2, 3]]]]];
export const webSource = (number: number): unknown[] => [null, null, null, [
    [sourceUrl, 'https://example.com/redirect', 'Example source'], number, null, null, null,
    [[0, 5, ['snippet']]],
]];
export const citation = (sources: unknown[], numbers = '1', openingOffset = 0): unknown[] => [
    [`[cite: ${numbers}]`, 0], sources, ['Quoted source text', 0], ['[cite_start]', openingOffset],
];

function response(document: unknown, declared: unknown[], markdown = 'A claim. [cite: 1]'): string {
    const candidate: unknown[] = ['rc_primary', [[markdown]]];
    candidate[44] = declared;
    const payload: unknown[] = [[candidate]];
    payload[12] = document;
    return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([
        [[['c_citationfixture', 'r_fixture'], [1700000000, 0], [['Question']], payload]],
    ])]]);
}

const workspaceBody = (reference: unknown): unknown[] => [citationText('A claim. '), citationField(31, [reference])];
const invalidFormatting = { nodeType: 18, text: 'abc', annotations: [{ start: 0, end: 99, type: 0 }] };
const compoundReference = citation([[workspace(false)]], '1.4');
const fileLocations = (marker: string): string => {
    const reference = citation([fileSource()], marker);
    return response({ children: workspaceBody(reference) }, [reference], `A claim. [cite:${marker}]`);
};
export const nativeCitationCases = {
    'G_NATIVE_CITATION_WORKSPACE': () => {
        const reference = citation([[workspace(true)]]);
        return response([[workspaceBody(reference)]], [reference]);
    },
    'G_NATIVE_CITATION_ADAPTER_FALLBACK': () => {
        const reference = citation([[workspace(false)]]);
        return response({ children: [...workspaceBody(reference), invalidFormatting] }, [reference]);
    },
    'G_NATIVE_CITATION_COMPOUND': () => response({ children: workspaceBody(compoundReference) }, [compoundReference], 'A claim. [cite:1.4]'),
    'G_NATIVE_CITATION_COMPOUND_ADAPTER_FALLBACK': () => response({ children: [...workspaceBody(compoundReference), invalidFormatting] }, [compoundReference], 'A claim. [cite:1.4]'),
    'G_NATIVE_CITATION_COMPOUND_DECODE_FALLBACK': () => response([[[...workspaceBody(compoundReference), citationField(38, ['unsupported'])]]], [compoundReference], 'A claim. [cite:1.4]'),
    'G_NATIVE_CITATION_FILE_LOCATIONS': () => fileLocations('24,25'),
    'G_NATIVE_CITATION_FILE_RANGES': () => fileLocations('22-32,112-122'),
    'G_NATIVE_CITATION_NESTED_METADATA': () => {
        const candidate: unknown[] = ['rc_primary', [['A claim. [cite:1.4]']]];
        candidate[12] = [{ '44': [compoundReference] }];
        return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([
            [[['c_citationfixture', 'r_fixture'], [1700000000, 0], [['Question']], [[candidate]]]],
        ])]]);
    },
    'G_NATIVE_CITATION_WHITESPACE': () => response(undefined, [citation([[workspace(false)], [workspace(false)]], '1.4, 2.3')],
        'Claim[cite:1.4,2.3] and again[CITE: 1.4, 2.3]. Plain [1] [1.4] [1-2] [1,2]; unknown [cite:9.9].'),
    'G_NATIVE_CITATION_OTHER_CANDIDATE': () => {
        const first: unknown[] = ['rc_primary', [['Claim[cite:1.4]']]];
        first[44] = [compoundReference];
        const payload: unknown[] = [[first, ['rc_selected', [['Claim[cite:1.4]']]]]];
        payload[3] = 'rc_selected';
        return JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([
            [[['c_citationfixture', 'r_fixture'], [1700000000, 0], [['Question']], payload]],
        ])]]);
    },
};
