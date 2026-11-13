import { citationField, citationText, coverageWire } from './content.js';

// Synthetic protocol counterexamples. Expected visible text is authored here,
// independently of the production decoder and Markdown renderer.
const plan = () => citationField(27, [[
    'PLAN_TITLE_ONLY_IN_NATIVE',
    [[1, 'Find sources', 'PLAN_DESCRIPTION_ONLY_IN_NATIVE'], [2, 'Analyse evidence'], [3, 'Write report']],
    'plan-fixture-id', ['Research summary'], ['https://example.com/research', 0],
    ['request-fixture-id', [null, null, null, 'control-fixture']],
]]);

function versioned(raw: unknown, markdown = 'Introduction.\n\nConclusion.'): string {
    const frames: unknown[] = JSON.parse(coverageWire(raw, [['rc_answer', [[markdown]]]]));
    frames.unshift(['wrb.fr', 'MaZiqc', JSON.stringify([null, null, [
        ['c_coverage', 'Coverage title', null, null, null, [1700000000, 0]],
    ]])]);
    return JSON.stringify(frames);
}

export const malformedNativeNodes = [1, 3, 10, 11, 12, 15, 34].map(field => citationField(field, 17));
export const ambiguousNativeNodes = [
    Object.assign(citationText('Known text.'), { 38: ['EXTRA_BODY_MUST_NOT_DISAPPEAR'] }),
    Object.assign(citationField(3, ['print(1)', 'python']), { 27: plan()[27] }),
];

export const nativeIntegrityCases = {
    'G_NATIVE_INTEGRITY_PLAN': () => versioned([[[citationText('Introduction.'), plan(), citationText('Conclusion.')]]]),
    'G_NATIVE_INTEGRITY_MARKDOWN_ONLY': () => versioned(undefined),
    'G_NATIVE_INTEGRITY_KNOWN': () => versioned([[[citationText('Introduction.'), citationText('Conclusion.')]]]),
    'G_NATIVE_INTEGRITY_BAD_FORMAT_RANGE': () => versioned([[[citationText('😀x', [[1, 2, [[null, null, null, null, 2]]]])]]], '😀x'),
    'G_NATIVE_INTEGRITY_BAD_SOURCE_RANGE': () => versioned({ children: [{ nodeType: 18, text: 'abc', annotations: [
        { start: 0, end: 99, type: 'source', sourceIds: ['spp_fixture'] },
    ] }] }, 'abc'),
    'G_NATIVE_INTEGRITY_MALFORMED': () => versioned([[[...malformedNativeNodes]]]),
    'G_NATIVE_INTEGRITY_AMBIGUOUS': () => versioned([[[...ambiguousNativeNodes]]]),
};
