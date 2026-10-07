/** Evidence-backed notation adaptation for the MiTeX engine. */
export interface LatexCompatRule {
    readonly id: string;
    readonly domain: 'tex';
    readonly evidence: string;
    readonly observedAt: string;
    readonly description: string;
    readonly originalHash?: string;
    readonly transform: (source: string) => string;
}
export const MATHSCR_COMPAT_RULE: LatexCompatRule = Object.freeze({
    id: 'GM-TEX-001',
    domain: 'tex',
    evidence: 'tests/fixtures/provider/math/gm_tex_001_evidence.tex',
    observedAt: '2026-10-01T18:00:00Z',
    description:
        'Normalizes \\mathscr to \\mathcal since Gemini frequently outputs standard physics ' +
        'script symbols (e.g. Bondi-Sachs Scri \\mathscr{I}) which MiTeX does not recognize in its base dictionary.',
    transform: (source: string) => source.replace(/\\mathscr(?![a-zA-Z])/g, '\\mathcal'),
});

/**
 * Active LaTeX compatibility rules.
 * Admitted per Section 4 & 31 admission policy with physical evidence fixture.
 */
export const LATEX_COMPAT_RULES: readonly LatexCompatRule[] = Object.freeze([
    MATHSCR_COMPAT_RULE,
]);

export function preprocessLatex(source: string): string {
    if (!LATEX_COMPAT_RULES.length) return source;
    let result = source;
    for (const rule of LATEX_COMPAT_RULES) {
        result = rule.transform(result);
    }
    return result;
}
