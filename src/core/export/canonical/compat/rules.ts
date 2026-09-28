/**
 * src/core/export/canonical/compat/rules.ts
 *
 * Gemini Exporter - Parser Compatibility Rule Registry
 *
 * Enforces the Compatibility Rule Admission Policy (Section 4 & 31):
 * - Initial state: empty (0 speculative rules).
 * - Every rule must have:
 *   - A unique rule ID (e.g. GM-MD-001, GM-TEX-001).
 *   - Provenance evidence pointing to a minimal real reproduction fixture.
 *   - Clear description explaining why standard parser behavior is insufficient for real Gemini.
 *   - Narrow deterministic transformation.
 */

export interface CompatRuleMetadata {
    /** Unique rule identifier, e.g. 'GM-MD-001' or 'GM-TEX-001' */
    readonly id: string;
    /** Relative path to minimal reproduction test fixture with real provenance */
    readonly evidence: string;
    /** Timestamp when this behavior was first observed on live Gemini */
    readonly observedAt: string;
    /** Concise explanation of why standard parser is insufficient */
    readonly description: string;
    /** Hash or fingerprint of the original minimal trigger input */
    readonly originalHash?: string;
}

export interface MarkdownCompatRule extends CompatRuleMetadata {
    readonly domain: 'markdown';
    readonly transform: (source: string) => string;
}

export interface TexCompatRule extends CompatRuleMetadata {
    readonly domain: 'tex';
    readonly transform: (source: string) => string;
}

/**
 * Active Markdown compatibility rules.
 * Initial state MUST remain empty per Section 2.4 / Section 31.
 */
export const GEMINI_MARKDOWN_COMPAT_RULES: readonly MarkdownCompatRule[] = Object.freeze([]);

/**
 * Active LaTeX compatibility rules.
 * Initial state MUST remain empty per Section 2.4 / Section 31.
 */
export const GEMINI_TEX_COMPAT_RULES: readonly TexCompatRule[] = Object.freeze([]);

/**
 * Preprocesses raw Gemini Markdown through registered compatibility rules.
 * When GEMINI_MARKDOWN_COMPAT_RULES is empty, this is an exact identity no-op.
 */
export function preprocessGeminiMarkdown(source: string): string {
    if (!GEMINI_MARKDOWN_COMPAT_RULES.length) return source;
    let result = source;
    for (const rule of GEMINI_MARKDOWN_COMPAT_RULES) {
        result = rule.transform(result);
    }
    return result;
}

/**
 * Preprocesses raw Gemini LaTeX through registered compatibility rules.
 * When GEMINI_TEX_COMPAT_RULES is empty, this is an exact identity no-op.
 */
export function preprocessGeminiLatex(source: string): string {
    if (!GEMINI_TEX_COMPAT_RULES.length) return source;
    let result = source;
    for (const rule of GEMINI_TEX_COMPAT_RULES) {
        result = rule.transform(result);
    }
    return result;
}
