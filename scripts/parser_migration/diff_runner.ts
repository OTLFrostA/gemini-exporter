/**
 * scripts/parser_migration/diff_runner.ts
 *
 * Legacy vs New Parser Differential Runner (Section 8.4, 22 & Remediation 1.1)
 *
 * CORE PRINCIPLE: The old parser is NOT an oracle.
 * Any structural or conversion difference between baseline and candidate
 * MUST default to 'D_CANNOT_DETERMINE' (unresolved observation).
 *
 * Automated promotion to 'B_OLD_PARSER_GEMINI_DIALECT' is strictly forbidden.
 * Reclassification requires explicit human review or verifiable evidence:
 *   - Category A: Upstream standard specification explicitly validates candidate (New parser correct).
 *   - Category B: Verifiable raw Gemini evidence proves old semantic is necessary dialect.
 *   - Category C: Both representations conform to reasonable standards.
 *   - Category D: Default unresolved difference pending investigation.
 */

export type DiffCategory =
    | 'A_NEW_PARSER_CORRECT'
    | 'B_OLD_PARSER_GEMINI_DIALECT'
    | 'C_BOTH_REASONABLE'
    | 'D_CANNOT_DETERMINE';

export interface BlockSummary {
    type: string;
    textLength: number;
    childCount: number;
    preview: string;
}

export interface AstSemanticFingerprint {
    blockCount: number;
    blockTypes: string[];
    blocks: BlockSummary[];
    totalTextLength: number;
}

export interface SemanticDiffResult {
    domain: 'markdown' | 'latex';
    inputPreview: string;
    hasDiff: boolean;
    category?: DiffCategory;
    rationale?: string;
    baseline: any;
    candidate: any;
}

/**
 * Extracts a simplified semantic fingerprint of a canonical AST message.
 */
export function extractAstFingerprint(bundle: any): AstSemanticFingerprint {
    const msg = bundle?.conversation?.messages?.[0];
    const blocks: any[] = msg?.blocks || [];

    const summaries: BlockSummary[] = blocks.map((b) => {
        let textLen = 0;
        let preview = '';
        if (b.type === 'paragraph' && Array.isArray(b.children)) {
            preview = b.children.map((c: any) => c.text || c.code || '').join('');
            textLen = preview.length;
        } else if (b.type === 'heading') {
            preview = b.text || '';
            textLen = preview.length;
        } else if (b.type === 'code') {
            preview = b.code || '';
            textLen = preview.length;
        } else if (b.type === 'math') {
            preview = b.source || '';
            textLen = preview.length;
        }
        return {
            type: b.type,
            textLength: textLen,
            childCount: Array.isArray(b.children) ? b.children.length : 0,
            preview: preview.slice(0, 60),
        };
    });

    const totalText = summaries.reduce((acc, curr) => acc + curr.textLength, 0);

    return {
        blockCount: blocks.length,
        blockTypes: blocks.map((b) => b.type),
        blocks: summaries,
        totalTextLength: totalText,
    };
}

/**
 * Compares two Markdown normalization results semantically.
 * Defaults all diffs to 'D_CANNOT_DETERMINE'. Old parser is NEVER assumed correct.
 */
export function compareMarkdownAst(
    input: string,
    baselineBundle: any,
    candidateBundle: any,
    explicitCategoryOverride?: { category: DiffCategory; rationale: string },
): SemanticDiffResult {
    const baseFp = extractAstFingerprint(baselineBundle);
    const candFp = extractAstFingerprint(candidateBundle);

    const hasDiff =
        baseFp.blockCount !== candFp.blockCount ||
        baseFp.blockTypes.join(',') !== candFp.blockTypes.join(',') ||
        Math.abs(baseFp.totalTextLength - candFp.totalTextLength) > 5;

    if (!hasDiff) {
        return {
            domain: 'markdown',
            inputPreview: input.slice(0, 80),
            hasDiff: false,
            baseline: baseFp,
            candidate: candFp,
        };
    }

    if (explicitCategoryOverride) {
        return {
            domain: 'markdown',
            inputPreview: input.slice(0, 80),
            hasDiff: true,
            category: explicitCategoryOverride.category,
            rationale: explicitCategoryOverride.rationale,
            baseline: baseFp,
            candidate: candFp,
        };
    }

    // Default to D_CANNOT_DETERMINE: Old parser is NOT an oracle.
    return {
        domain: 'markdown',
        inputPreview: input.slice(0, 80),
        hasDiff: true,
        category: 'D_CANNOT_DETERMINE',
        rationale:
            'Structural difference detected between baseline and candidate. Old parser is not an oracle; requires standard validation or verified raw Gemini evidence to reclassify.',
        baseline: baseFp,
        candidate: candFp,
    };
}

/**
 * Compares two LaTeX math conversion results semantically.
 * Defaults diffs to 'D_CANNOT_DETERMINE' unless candidate is demonstrably superior.
 */
export function compareMathConversion(
    latex: string,
    baselineResult: { typst?: string; diagnostic?: any },
    candidateResult: { typst?: string; diagnostic?: any },
    explicitCategoryOverride?: { category: DiffCategory; rationale: string },
): SemanticDiffResult {
    const hasDiff =
        baselineResult.typst !== candidateResult.typst ||
        !!baselineResult.diagnostic !== !!candidateResult.diagnostic;

    if (!hasDiff) {
        return {
            domain: 'latex',
            inputPreview: latex.slice(0, 80),
            hasDiff: false,
            baseline: baselineResult,
            candidate: candidateResult,
        };
    }

    if (explicitCategoryOverride) {
        return {
            domain: 'latex',
            inputPreview: latex.slice(0, 80),
            hasDiff: true,
            category: explicitCategoryOverride.category,
            rationale: explicitCategoryOverride.rationale,
            baseline: baselineResult,
            candidate: candidateResult,
        };
    }

    // If candidate successfully converts where baseline failed/fell back, it is an upstream capability improvement
    if (!baselineResult.typst && candidateResult.typst) {
        return {
            domain: 'latex',
            inputPreview: latex.slice(0, 80),
            hasDiff: true,
            category: 'A_NEW_PARSER_CORRECT',
            rationale: 'Candidate successfully converted LaTeX expression where baseline fell back.',
            baseline: baselineResult,
            candidate: candidateResult,
        };
    }

    // In all other divergence cases (candidate failed or notation differs), default to D
    return {
        domain: 'latex',
        inputPreview: latex.slice(0, 80),
        hasDiff: true,
        category: 'D_CANNOT_DETERMINE',
        rationale:
            'Math conversion divergence detected. Old converter is not an oracle; requires MiTeX standard verification or raw Gemini evidence.',
        baseline: baselineResult,
        candidate: candidateResult,
    };
}
