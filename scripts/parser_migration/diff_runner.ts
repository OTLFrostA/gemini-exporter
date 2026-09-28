/**
 * scripts/parser_migration/diff_runner.ts
 *
 * Legacy vs New Parser Differential Runner (Section 8.4, 22 & Remediation 1.1)
 *
 * CORE INVARIANTS:
 * 1. The old parser is NOT an oracle.
 *    Any structural or conversion difference between baseline and candidate
 *    MUST default to 'D_CANNOT_DETERMINE' (unresolved observation).
 *    Automated promotion to 'B_OLD_PARSER_GEMINI_DIALECT' is strictly forbidden.
 * 2. Semantic Comparison Invariant:
 *    AST comparison is performed recursively on the Canonical AST schema,
 *    ignoring ephemeral metadata (random IDs, sourceRef byte offsets, provider extensions)
 *    while strictly catching formatting loss, broken links, table alterations, and math loss.
 */

export type DiffCategory =
    | 'A_NEW_PARSER_CORRECT'
    | 'B_OLD_PARSER_GEMINI_DIALECT'
    | 'C_BOTH_REASONABLE'
    | 'D_CANNOT_DETERMINE';

export type DiffRationaleKind =
    | 'IDENTICAL'
    | 'FORMATTING_LOST'
    | 'LINK_CORRUPTED'
    | 'MATH_CORRUPTED'
    | 'TABLE_DIVERGENCE'
    | 'STRUCTURE_DIVERGENCE'
    | 'CONTENT_CHANGED'
    | 'UNKNOWN_FALLBACK_DIVERGENCE';

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
    rationaleKind?: DiffRationaleKind;
    rationale?: string;
    candidateConversionGain?: boolean;
    baseline: any;
    candidate: any;
}

export interface NormalizedInline {
    type: string;
    text?: string;
    code?: string;
    source?: string;
    notation?: string;
    href?: string;
    title?: string;
    assetId?: string;
    alt?: string;
    citationId?: string;
    label?: string;
    kind?: string;
    sourceType?: string;
    fallbackText?: string;
    rawRef?: string;
    children?: NormalizedInline[];
}

export interface NormalizedTableCell {
    children: NormalizedInline[];
    colSpan?: number;
    rowSpan?: number;
}

export interface NormalizedTableRow {
    cells: NormalizedTableCell[];
}

export interface NormalizedBlock {
    type: string;
    level?: number;
    ordered?: boolean;
    start?: number;
    code?: string;
    language?: string;
    meta?: string;
    filename?: string;
    source?: string;
    notation?: string;
    assetId?: string;
    alt?: string;
    origin?: string;
    label?: string;
    callId?: string;
    toolName?: string;
    status?: string;
    sourceType?: string;
    disclosure?: string;
    kind?: string;
    children?: NormalizedInline[];
    blocks?: NormalizedBlock[];
    items?: Array<{ blocks: NormalizedBlock[] }>;
    caption?: NormalizedInline[];
    columns?: Array<{ align?: string }>;
    headerRows?: NormalizedTableRow[];
    rows?: NormalizedTableRow[];
    citationIds?: string[];
    title?: NormalizedInline[];
    displayBlocks?: NormalizedBlock[];
    fallbackBlocks?: NormalizedBlock[];
}

/**
 * Normalizes an inline node by stripping ephemeral metadata (id, sourceRef, extensions).
 */
export function normalizeSemanticInline(node: any): NormalizedInline {
    if (!node || typeof node !== 'object') {
        return { type: 'text', text: String(node ?? '') };
    }
    const type = node.type || 'text';
    switch (type) {
        case 'text':
            return { type: 'text', text: node.text ?? '' };
        case 'strong':
        case 'emphasis':
        case 'strikethrough':
            return {
                type,
                children: (node.children || []).map(normalizeSemanticInline),
            };
        case 'inlineCode':
            return { type: 'inlineCode', code: node.code ?? '' };
        case 'link':
            return {
                type: 'link',
                href: node.href ?? '',
                ...(node.title ? { title: node.title } : {}),
                children: (node.children || []).map(normalizeSemanticInline),
            };
        case 'image':
            return {
                type: 'image',
                assetId: node.assetId ?? '',
                ...(node.alt ? { alt: node.alt } : {}),
                ...(node.title ? { title: node.title } : {}),
            };
        case 'inlineMath':
            return {
                type: 'inlineMath',
                source: node.source ?? '',
                notation: node.notation ?? 'latex',
            };
        case 'citationRef':
            return {
                type: 'citationRef',
                citationId: node.citationId ?? '',
                ...(node.label ? { label: node.label } : {}),
            };
        case 'lineBreak':
            return {
                type: 'lineBreak',
                kind: node.kind ?? 'soft',
            };
        case 'unknownInline':
            return {
                type: 'unknownInline',
                sourceType: node.sourceType ?? 'unknown',
                ...(node.fallbackText ? { fallbackText: node.fallbackText } : {}),
                ...(node.rawRef ? { rawRef: node.rawRef } : {}),
            };
        default:
            return {
                type: String(type),
                text: node.text || node.code || '',
            };
    }
}

/**
 * Recursively extracts visible human-readable text from an inline node.
 */
export function extractVisibleTextFromInline(node: any): string {
    if (!node) return '';
    if (typeof node === 'string') return node;
    switch (node.type) {
        case 'text':
            return node.text || '';
        case 'strong':
        case 'emphasis':
        case 'strikethrough':
        case 'link':
            return (node.children || []).map(extractVisibleTextFromInline).join('');
        case 'inlineCode':
            return node.code || '';
        case 'inlineMath':
            return node.source || '';
        case 'image':
            return node.alt || '';
        case 'lineBreak':
            return '\n';
        case 'citationRef':
            return node.label || '';
        case 'unknownInline':
            return node.fallbackText || '';
        default:
            return node.text || node.code || '';
    }
}

/**
 * Normalizes a block node by stripping ephemeral metadata (id, sourceRef, extensions).
 */
export function normalizeSemanticBlock(block: any): NormalizedBlock {
    if (!block || typeof block !== 'object') {
        return { type: 'unknown', sourceType: 'invalid' };
    }
    const type = block.type || 'unknown';
    switch (type) {
        case 'paragraph':
            return {
                type: 'paragraph',
                children: (block.children || []).map(normalizeSemanticInline),
            };
        case 'heading': {
            let children: NormalizedInline[];
            if (Array.isArray(block.children)) {
                children = block.children.map(normalizeSemanticInline);
            } else if (typeof block.text === 'string') {
                children = [{ type: 'text', text: block.text }];
            } else {
                children = [];
            }
            return {
                type: 'heading',
                level: block.level ?? 1,
                children,
            };
        }
        case 'list':
            return {
                type: 'list',
                ordered: !!block.ordered,
                ...(block.start !== undefined ? { start: block.start } : {}),
                items: (block.items || []).map((it: any) => ({
                    blocks: (it.blocks || []).map(normalizeSemanticBlock),
                })),
            };
        case 'quote':
            return {
                type: 'quote',
                blocks: (block.blocks || []).map(normalizeSemanticBlock),
            };
        case 'code':
            return {
                type: 'code',
                code: block.code ?? '',
                ...(block.language ? { language: block.language.toLowerCase().trim() } : {}),
                ...(block.meta ? { meta: block.meta } : {}),
                ...(block.filename ? { filename: block.filename } : {}),
            };
        case 'math':
            return {
                type: 'math',
                source: block.source ?? '',
                notation: block.notation ?? 'latex',
            };
        case 'table':
            return {
                type: 'table',
                ...(block.caption ? { caption: (block.caption || []).map(normalizeSemanticInline) } : {}),
                columns: (block.columns || []).map((c: any) => ({ align: c?.align ?? 'default' })),
                headerRows: (block.headerRows || []).map((r: any) => ({
                    cells: (r.cells || []).map((cell: any) => ({
                        children: (cell.children || []).map(normalizeSemanticInline),
                        ...(cell.colSpan ? { colSpan: cell.colSpan } : {}),
                        ...(cell.rowSpan ? { rowSpan: cell.rowSpan } : {}),
                    })),
                })),
                rows: (block.rows || []).map((r: any) => ({
                    cells: (r.cells || []).map((cell: any) => ({
                        children: (cell.children || []).map(normalizeSemanticInline),
                        ...(cell.colSpan ? { colSpan: cell.colSpan } : {}),
                        ...(cell.rowSpan ? { rowSpan: cell.rowSpan } : {}),
                    })),
                })),
            };
        case 'image':
            return {
                type: 'image',
                assetId: block.assetId ?? '',
                ...(block.alt ? { alt: block.alt } : {}),
                ...(block.caption ? { caption: (block.caption || []).map(normalizeSemanticInline) } : {}),
                ...(block.origin ? { origin: block.origin } : {}),
            };
        case 'file':
            return {
                type: 'file',
                assetId: block.assetId ?? '',
                ...(block.label ? { label: block.label } : {}),
                ...(block.origin ? { origin: block.origin } : {}),
            };
        case 'citationGroup':
            return {
                type: 'citationGroup',
                citationIds: Array.isArray(block.citationIds) ? [...block.citationIds] : [],
                ...(block.title ? { title: (block.title || []).map(normalizeSemanticInline) } : {}),
            };
        case 'thought':
            return {
                type: 'thought',
                disclosure: block.disclosure ?? 'providerExposed',
                ...(block.kind ? { kind: block.kind } : {}),
                blocks: (block.blocks || []).map(normalizeSemanticBlock),
            };
        case 'toolCall':
            return {
                type: 'toolCall',
                callId: block.callId ?? '',
                toolName: block.toolName ?? '',
                status: block.status ?? 'completed',
                ...(block.displayBlocks ? { displayBlocks: (block.displayBlocks || []).map(normalizeSemanticBlock) } : {}),
            };
        case 'toolResult':
            return {
                type: 'toolResult',
                callId: block.callId ?? '',
                ...(block.toolName ? { toolName: block.toolName } : {}),
                status: block.status ?? 'completed',
                ...(block.displayBlocks ? { displayBlocks: (block.displayBlocks || []).map(normalizeSemanticBlock) } : {}),
            };
        case 'thematicBreak':
            return { type: 'thematicBreak' };
        case 'unknown':
            return {
                type: 'unknown',
                sourceType: block.sourceType ?? 'unknown',
                ...(block.rawRef ? { rawRef: block.rawRef } : {}),
                ...(block.fallbackBlocks ? { fallbackBlocks: (block.fallbackBlocks || []).map(normalizeSemanticBlock) } : {}),
            };
        default:
            return {
                type: String(type),
                sourceType: block.sourceType,
            };
    }
}

/**
 * Recursively extracts visible human-readable text from a block node.
 */
export function extractVisibleTextFromBlock(block: any): string {
    if (!block) return '';
    switch (block.type) {
        case 'paragraph':
        case 'heading': {
            if (Array.isArray(block.children)) {
                return block.children.map(extractVisibleTextFromInline).join('');
            }
            return block.text || '';
        }
        case 'list':
            return (block.items || [])
                .map((it: any) => (it.blocks || []).map(extractVisibleTextFromBlock).join(''))
                .join('');
        case 'quote':
            return (block.blocks || []).map(extractVisibleTextFromBlock).join('');
        case 'code':
            return block.code || '';
        case 'math':
            return block.source || '';
        case 'table': {
            const rows: string[] = [];
            for (const r of block.headerRows || []) {
                rows.push((r.cells || []).map((c: any) => (c.children || []).map(extractVisibleTextFromInline).join('')).join('\t'));
            }
            for (const r of block.rows || []) {
                rows.push((r.cells || []).map((c: any) => (c.children || []).map(extractVisibleTextFromInline).join('')).join('\t'));
            }
            return rows.join('\n');
        }
        case 'thought':
            return (block.blocks || []).map(extractVisibleTextFromBlock).join('');
        case 'thematicBreak':
            return '---';
        default:
            return block.text || block.code || block.source || '';
    }
}

/**
 * Extracts a rich semantic fingerprint of a canonical AST message.
 */
export function extractAstFingerprint(bundle: any): AstSemanticFingerprint {
    const msg = bundle?.conversation?.messages?.[0];
    const blocks: any[] = msg?.blocks || [];

    const summaries: BlockSummary[] = blocks.map((b) => {
        const text = extractVisibleTextFromBlock(b);
        let childCount = 0;
        if (Array.isArray(b.children)) {
            childCount = b.children.length;
        } else if (Array.isArray(b.items)) {
            childCount = b.items.length;
        } else if (Array.isArray(b.blocks)) {
            childCount = b.blocks.length;
        } else if (Array.isArray(b.rows)) {
            childCount = b.rows.length + (b.headerRows ? b.headerRows.length : 0);
        }

        return {
            type: b.type,
            textLength: text.length,
            childCount,
            preview: text.slice(0, 60),
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

interface AstComparisonDiagnostic {
    kind: DiffRationaleKind;
    message: string;
}

/**
 * Recursively compares inline structures and detects specific semantic discrepancies.
 */
function compareInlines(
    path: string,
    baseList: NormalizedInline[],
    candList: NormalizedInline[]
): AstComparisonDiagnostic | null {
    if (baseList.length !== candList.length) {
        // Check if one coalesced text
        const baseText = baseList.map(extractVisibleTextFromInline).join('');
        const candText = candList.map(extractVisibleTextFromInline).join('');
        if (baseText !== candText) {
            return {
                kind: 'CONTENT_CHANGED',
                message: `${path}: visible text differs ("${baseText.slice(0, 30)}" vs "${candText.slice(0, 30)}")`,
            };
        }
    }

    for (let i = 0; i < Math.max(baseList.length, candList.length); i++) {
        const b = baseList[i];
        const c = candList[i];
        if (!b || !c) {
            return {
                kind: 'FORMATTING_LOST',
                message: `${path}[${i}]: inline node count mismatch`,
            };
        }

        if (b.type !== c.type) {
            if ((b.type === 'strong' || b.type === 'emphasis' || b.type === 'strikethrough') && c.type === 'text') {
                return {
                    kind: 'FORMATTING_LOST',
                    message: `${path}[${i}]: baseline formatting '${b.type}' was lost in candidate to plain text '${c.text}'`,
                };
            }
            if (b.type === 'text' && (c.type === 'strong' || c.type === 'emphasis' || c.type === 'strikethrough')) {
                return {
                    kind: 'FORMATTING_LOST',
                    message: `${path}[${i}]: candidate introduced formatting '${c.type}' where baseline had plain text '${b.text}'`,
                };
            }
            if (b.type === 'link' || c.type === 'link') {
                return {
                    kind: 'LINK_CORRUPTED',
                    message: `${path}[${i}]: link node type mismatch ('${b.type}' vs '${c.type}')`,
                };
            }
            if (b.type === 'inlineMath' || c.type === 'inlineMath') {
                return {
                    kind: 'MATH_CORRUPTED',
                    message: `${path}[${i}]: math inline node type mismatch ('${b.type}' vs '${c.type}')`,
                };
            }
            return {
                kind: 'STRUCTURE_DIVERGENCE',
                message: `${path}[${i}]: inline type mismatch ('${b.type}' vs '${c.type}')`,
            };
        }

        // Same type: check attributes
        if (b.type === 'text' && b.text !== c.text) {
            return {
                kind: 'CONTENT_CHANGED',
                message: `${path}[${i}]: text content differs ("${b.text}" vs "${c.text}")`,
            };
        }
        if (b.type === 'inlineCode' && b.code !== c.code) {
            return {
                kind: 'CONTENT_CHANGED',
                message: `${path}[${i}]: inline code differs ("${b.code}" vs "${c.code}")`,
            };
        }
        if (b.type === 'link') {
            if (b.href !== c.href) {
                return {
                    kind: 'LINK_CORRUPTED',
                    message: `${path}[${i}]: link href mismatch ("${b.href}" vs "${c.href}")`,
                };
            }
            const nested = compareInlines(`${path}[${i}].children`, b.children || [], c.children || []);
            if (nested) return nested;
        }
        if (b.type === 'inlineMath') {
            if (b.source !== c.source || b.notation !== c.notation) {
                return {
                    kind: 'MATH_CORRUPTED',
                    message: `${path}[${i}]: math source/notation mismatch ("${b.source}" vs "${c.source}")`,
                };
            }
        }
        if (b.children || c.children) {
            const nested = compareInlines(`${path}[${i}].children`, b.children || [], c.children || []);
            if (nested) return nested;
        }
    }

    return null;
}

/**
 * Recursively compares normalized blocks.
 */
function compareBlocks(
    path: string,
    baseBlocks: NormalizedBlock[],
    candBlocks: NormalizedBlock[]
): AstComparisonDiagnostic | null {
    if (baseBlocks.length !== candBlocks.length) {
        return {
            kind: 'STRUCTURE_DIVERGENCE',
            message: `${path}: block count mismatch (${baseBlocks.length} vs ${candBlocks.length})`,
        };
    }

    for (let i = 0; i < baseBlocks.length; i++) {
        const b = baseBlocks[i];
        const c = candBlocks[i];
        const itemPath = `${path}[${i} (${b.type})]`;

        if (b.type !== c.type) {
            if (b.type === 'table' || c.type === 'table') {
                return {
                    kind: 'TABLE_DIVERGENCE',
                    message: `${itemPath}: table block converted to non-table ('${b.type}' vs '${c.type}')`,
                };
            }
            if (b.type === 'math' || c.type === 'math') {
                return {
                    kind: 'MATH_CORRUPTED',
                    message: `${itemPath}: math block converted to non-math ('${b.type}' vs '${c.type}')`,
                };
            }
            if (b.type === 'unknown' || c.type === 'unknown') {
                return {
                    kind: 'UNKNOWN_FALLBACK_DIVERGENCE',
                    message: `${itemPath}: unknown block fallback mismatch ('${b.type}' vs '${c.type}')`,
                };
            }
            return {
                kind: 'STRUCTURE_DIVERGENCE',
                message: `${itemPath}: block type mismatch ('${b.type}' vs '${c.type}')`,
            };
        }

        // Same block type: deep check
        if (b.type === 'heading') {
            if (b.level !== c.level) {
                return {
                    kind: 'STRUCTURE_DIVERGENCE',
                    message: `${itemPath}: heading level mismatch (${b.level} vs ${c.level})`,
                };
            }
            const inlinesDiff = compareInlines(`${itemPath}.children`, b.children || [], c.children || []);
            if (inlinesDiff) return inlinesDiff;
        } else if (b.type === 'paragraph') {
            const inlinesDiff = compareInlines(`${itemPath}.children`, b.children || [], c.children || []);
            if (inlinesDiff) return inlinesDiff;
        } else if (b.type === 'code') {
            if (b.language !== c.language) {
                return {
                    kind: 'STRUCTURE_DIVERGENCE',
                    message: `${itemPath}: code language mismatch ('${b.language}' vs '${c.language}')`,
                };
            }
            if (b.code !== c.code) {
                return {
                    kind: 'CONTENT_CHANGED',
                    message: `${itemPath}: code content differs`,
                };
            }
        } else if (b.type === 'math') {
            if (b.source !== c.source || b.notation !== c.notation) {
                return {
                    kind: 'MATH_CORRUPTED',
                    message: `${itemPath}: math source/notation differs ("${b.source}" vs "${c.source}")`,
                };
            }
        } else if (b.type === 'list') {
            if (b.ordered !== c.ordered) {
                return {
                    kind: 'STRUCTURE_DIVERGENCE',
                    message: `${itemPath}: list ordered flag differs (${b.ordered} vs ${c.ordered})`,
                };
            }
            const bItems = b.items || [];
            const cItems = c.items || [];
            if (bItems.length !== cItems.length) {
                return {
                    kind: 'STRUCTURE_DIVERGENCE',
                    message: `${itemPath}: list item count differs (${bItems.length} vs ${cItems.length})`,
                };
            }
            for (let j = 0; j < bItems.length; j++) {
                const subDiff = compareBlocks(`${itemPath}.item[${j}]`, bItems[j].blocks || [], cItems[j].blocks || []);
                if (subDiff) return subDiff;
            }
        } else if (b.type === 'quote') {
            const subDiff = compareBlocks(`${itemPath}.blocks`, b.blocks || [], c.blocks || []);
            if (subDiff) return subDiff;
        } else if (b.type === 'table') {
            const bCols = (b.columns || []).map((x) => x.align || 'default');
            const cCols = (c.columns || []).map((x) => x.align || 'default');
            if (bCols.join(',') !== cCols.join(',')) {
                return {
                    kind: 'TABLE_DIVERGENCE',
                    message: `${itemPath}: column alignment mismatch (${bCols.join(',')} vs ${cCols.join(',')})`,
                };
            }
            const bHRows = b.headerRows || [];
            const cHRows = c.headerRows || [];
            if (bHRows.length !== cHRows.length) {
                return {
                    kind: 'TABLE_DIVERGENCE',
                    message: `${itemPath}: table header row count mismatch (${bHRows.length} vs ${cHRows.length})`,
                };
            }
            const bRows = b.rows || [];
            const cRows = c.rows || [];
            if (bRows.length !== cRows.length) {
                return {
                    kind: 'TABLE_DIVERGENCE',
                    message: `${itemPath}: table body row count mismatch (${bRows.length} vs ${cRows.length})`,
                };
            }
            for (let r = 0; r < bRows.length; r++) {
                const bCells = bRows[r].cells || [];
                const cCells = cRows[r].cells || [];
                if (bCells.length !== cCells.length) {
                    return {
                        kind: 'TABLE_DIVERGENCE',
                        message: `${itemPath}: row[${r}] cell count mismatch (${bCells.length} vs ${cCells.length})`,
                    };
                }
                for (let cellIdx = 0; cellIdx < bCells.length; cellIdx++) {
                    const cellDiff = compareInlines(
                        `${itemPath}.row[${r}].cell[${cellIdx}]`,
                        bCells[cellIdx].children || [],
                        cCells[cellIdx].children || []
                    );
                    if (cellDiff) {
                        return {
                            kind: 'TABLE_DIVERGENCE',
                            message: `${itemPath}: row[${r}].cell[${cellIdx}] content differs: ${cellDiff.message}`,
                        };
                    }
                }
            }
        } else {
            // General fallback comparison via normalized JSON
            const bJson = JSON.stringify(b);
            const cJson = JSON.stringify(c);
            if (bJson !== cJson) {
                return {
                    kind: 'STRUCTURE_DIVERGENCE',
                    message: `${itemPath}: normalized JSON representation differs`,
                };
            }
        }
    }

    return null;
}

/**
 * Compares two Markdown normalization results semantically and recursively.
 *
 * Invariant: Defaults all diffs to 'D_CANNOT_DETERMINE'.
 * Old parser is NEVER assumed correct.
 */
export function compareMarkdownAst(
    input: string,
    baselineBundle: any,
    candidateBundle: any,
    explicitCategoryOverride?: { category: DiffCategory; rationale: string },
): SemanticDiffResult {
    const baseFp = extractAstFingerprint(baselineBundle);
    const candFp = extractAstFingerprint(candidateBundle);

    const baseBlocks: any[] = baselineBundle?.conversation?.messages?.[0]?.blocks || [];
    const candBlocks: any[] = candidateBundle?.conversation?.messages?.[0]?.blocks || [];

    const normBase = baseBlocks.map(normalizeSemanticBlock);
    const normCand = candBlocks.map(normalizeSemanticBlock);

    const diffDiag = compareBlocks('root', normBase, normCand);

    if (!diffDiag) {
        return {
            domain: 'markdown',
            inputPreview: input.slice(0, 80),
            hasDiff: false,
            rationaleKind: 'IDENTICAL',
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
            rationaleKind: diffDiag.kind,
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
        rationaleKind: diffDiag.kind,
        rationale: `[${diffDiag.kind}] ${diffDiag.message}. Old parser is not an oracle; requires standard validation or verified raw Gemini evidence to reclassify.`,
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
            rationaleKind: 'IDENTICAL',
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

    const candidateConversionGain = !baselineResult.typst && !!candidateResult.typst;

    // All parser/converter differentials default to D_CANNOT_DETERMINE: Old parser is NOT an oracle.
    // Observation (candidateConversionGain) is separated from judgment (category).
    return {
        domain: 'latex',
        inputPreview: latex.slice(0, 80),
        hasDiff: true,
        category: 'D_CANNOT_DETERMINE',
        candidateConversionGain,
        rationaleKind: candidateConversionGain ? 'IDENTICAL' : 'MATH_CORRUPTED',
        rationale: candidateConversionGain
            ? 'Candidate converted LaTeX expression where baseline fell back. Diff defaults to D_CANNOT_DETERMINE until verified against LaTeX/MiTeX standards or project policy.'
            : 'Math conversion divergence detected. Old converter is not an oracle; requires MiTeX standard verification or raw Gemini evidence.',
        baseline: baselineResult,
        candidate: candidateResult,
    };
}
