/**
 * scripts/parser_migration/diff_runner.ts
 *
 * Legacy vs New Parser Differential Runner (Section 8.4 & Section 22)
 *
 * Provides semantic difference comparison between two parsers/converters.
 * NOT an oracle: Diffs are categorized into 4 tiers rather than failing:
 *   - Category A: New parser clearly correct (upstream standard)
 *   - Category B: Old parser clearly correct because real Gemini requires it
 *   - Category C: Both reasonable (prefer standard behavior)
 *   - Category D: Cannot determine (unresolved observation)
 */

import * as fs from 'fs';
import * as path from 'path';
import { normalizeGeminiConversation } from '../../src/core/export/canonical/normalizeGemini.js';
import { convertMathWithDiagnostic } from '../../src/core/export/typst/math/convertMath.js';

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
 */
export function compareMarkdownAst(
    input: string,
    baselineBundle: any,
    candidateBundle: any,
    provenanceTag?: string,
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

    // Categorization logic per Section 8.4
    let category: DiffCategory = 'D_CANNOT_DETERMINE';
    let rationale = 'Structural difference detected between baseline and candidate parser';

    if (provenanceTag === 'P0' || provenanceTag === 'real-gemini') {
        category = 'B_OLD_PARSER_GEMINI_DIALECT';
        rationale = 'Difference observed on real Gemini provenance data; requires provenance fixture check';
    } else if (candFp.blockTypes.includes('unknown') && !baseFp.blockTypes.includes('unknown')) {
        category = 'B_OLD_PARSER_GEMINI_DIALECT';
        rationale = 'Candidate produced unknown block fallback where baseline parsed cleanly';
    } else if (!candFp.blockTypes.includes('unknown') && baseFp.blockTypes.includes('unknown')) {
        category = 'A_NEW_PARSER_CORRECT';
        rationale = 'Candidate parsed cleanly where baseline produced unknown block fallback';
    } else if (baseFp.blockCount === candFp.blockCount) {
        category = 'C_BOTH_REASONABLE';
        rationale = 'Block structure identical; minor inline representation difference';
    }

    return {
        domain: 'markdown',
        inputPreview: input.slice(0, 80),
        hasDiff: true,
        category,
        rationale,
        baseline: baseFp,
        candidate: candFp,
    };
}

/**
 * Compares two LaTeX math conversion results semantically.
 */
export function compareMathConversion(
    latex: string,
    baselineResult: { typst?: string; diagnostic?: any },
    candidateResult: { typst?: string; diagnostic?: any },
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

    let category: DiffCategory = 'D_CANNOT_DETERMINE';
    let rationale = 'Difference in converted Typst math source';

    if (!baselineResult.typst && candidateResult.typst) {
        category = 'A_NEW_PARSER_CORRECT';
        rationale = 'Candidate successfully converted LaTeX expression where baseline fell back';
    } else if (baselineResult.typst && !candidateResult.typst) {
        category = 'B_OLD_PARSER_GEMINI_DIALECT';
        rationale = 'Candidate failed to convert expression where baseline succeeded';
    } else if (baselineResult.typst && candidateResult.typst) {
        category = 'C_BOTH_REASONABLE';
        rationale = 'Both converted successfully; slight Typst notation difference';
    }

    return {
        domain: 'latex',
        inputPreview: latex.slice(0, 80),
        hasDiff: true,
        category,
        rationale,
        baseline: baselineResult,
        candidate: candidateResult,
    };
}
