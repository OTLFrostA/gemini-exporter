import type { BlockNode } from '../../../../l2/content/blocks.js';
import type { InlineNode } from '../../../../l2/content/inline.js';
import { GEMINI_NODE_TYPES } from '../rpc/jspbSchema.js';
import type {
    GeminiPartialStructuredSlot,
    GeminiStructuredNode,
} from '../rpc/structuredContent.js';
import type { GeminiSourceAttribution } from '../rpc/sourceAttributions.js';
import {
    geminiStructuredToContent,
    type GeminiSourceCitations,
    type GeminiSourceFailure,
    type GeminiStructuredContext,
} from './structuredContentAdapter.js';
import { recoverGeminiSourceRanges } from './sourceRanges.js';
import type { CandidateMarkdownIndex } from './candidateMarkdown.js';

function isCardOrAttachmentNode(node: GeminiStructuredNode): boolean {
    return node.nodeType === 'fragment'
        || node.nodeType === 'markup'
        || node.nodeType === GEMINI_NODE_TYPES.GENERATED_FILE
        || node.nodeType === GEMINI_NODE_TYPES.ATTACHMENT
        || node.nodeType === GEMINI_NODE_TYPES.LINE_BREAK;
}

function stripGroundingMarkers(text: string, markers?: readonly string[]): string {
    if (!markers?.length) return text;
    let out = text;
    for (const marker of markers) {
        if (marker) out = out.split(marker).join('');
    }
    return out;
}

function inlineAnchorText(nodes: readonly InlineNode[], markers?: readonly string[]): string | null {
    const parts: string[] = [];
    for (const node of nodes) {
        switch (node.type) {
            case 'text':
                parts.push(stripGroundingMarkers(node.text, markers));
                break;
            case 'inlineCode':
                parts.push(node.code);
                break;
            case 'inlineMath':
                parts.push(`$${node.source}$`);
                break;
            case 'lineBreak':
                parts.push('\n');
                break;
            case 'citationRef':
                // Native inline citations have no counterpart in unclosed fallback Markdown.
                break;
            case 'strong':
            case 'emphasis':
            case 'strikethrough':
            case 'link': {
                const nested = inlineAnchorText(node.children, markers);
                if (nested === null) return null;
                parts.push(nested);
                break;
            }
            default:
                return null;
        }
    }
    return parts.join('').replace(/\s+/g, ' ').trim();
}

function blockAnchorSignature(block: BlockNode, markers?: readonly string[]): string | null {
    switch (block.type) {
        case 'paragraph': {
            const text = inlineAnchorText(block.children, markers);
            return text !== null ? `p:${text}` : null;
        }
        case 'heading': {
            const text = inlineAnchorText(block.children, markers);
            return text !== null ? `h${block.level}:${text}` : null;
        }
        case 'code':
            return `code:${block.code.replace(/\r\n/g, '\n').trimEnd()}`;
        case 'math':
            return `math:${block.source.replace(/\s+/g, ' ').trim()}`;
        case 'thematicBreak':
            return 'hr';
        case 'quote': {
            const inner: string[] = [];
            for (const child of block.blocks) {
                const sig = blockAnchorSignature(child, markers);
                if (sig === null) return null;
                inner.push(sig);
            }
            return `quote:[${inner.join('|')}]`;
        }
        case 'list': {
            const items: string[] = [];
            for (const item of block.items) {
                const sub: string[] = [];
                for (const child of item.blocks) {
                    const sig = blockAnchorSignature(child, markers);
                    if (sig === null) return null;
                    sub.push(sig);
                }
                items.push(sub.join('|'));
            }
            return `list:${block.ordered ? 'o' : 'u'}:[${items.join(';')}]`;
        }
        case 'table': {
            const rows = [...(block.headerRows ?? []), ...block.rows];
            const rowSigs: string[] = [];
            for (const row of rows) {
                const cellSigs: string[] = [];
                for (const cell of row.cells) {
                    const text = inlineAnchorText(cell.children, markers);
                    if (text === null) return null;
                    cellSigs.push(text);
                }
                rowSigs.push(cellSigs.join('\t'));
            }
            return `table:[${rowSigs.join('\n')}]`;
        }
        default:
            return null;
    }
}

/** Find the unique strictly increasing index mapping of `anchorSigs` inside `mdSigs`.
 * Returns null if no mapping exists or if more than one valid monotonic mapping exists. */
function uniqueMonotonicAnchors(anchorSigs: readonly string[], mdSigs: readonly (string | null)[]): number[] | null {
    const n = anchorSigs.length;
    const m = mdSigs.length;
    if (n === 0 || n > m) return null;

    const earliest = new Array<number>(n);
    let cursor = 0;
    for (let i = 0; i < n; i++) {
        while (cursor < m && mdSigs[cursor] !== anchorSigs[i]) cursor++;
        if (cursor >= m) return null;
        earliest[i] = cursor;
        cursor++;
    }

    const latest = new Array<number>(n);
    cursor = m - 1;
    for (let i = n - 1; i >= 0; i--) {
        while (cursor >= 0 && mdSigs[cursor] !== anchorSigs[i]) cursor--;
        if (cursor < 0) return null;
        latest[i] = cursor;
        cursor--;
    }

    for (let i = 0; i < n; i++) {
        if (earliest[i] !== latest[i]) return null;
    }
    return earliest;
}

interface PartialStructuredRecoveryResult {
    readonly blocks: BlockNode[];
    readonly sourceRangesRecovered: number;
    readonly sourceFailures: GeminiSourceFailure[];
    readonly nativeBlocksRetained: number;
}

/**
 * Recover decodable top-level blocks (preserving inline source citations and
 * rich provider cards) around isolated unknown/rejected sibling blocks when
 * surrounding prose blocks establish a unique 1:1 monotonic alignment with the
 * selected candidate's fallback Markdown.
 */
export function recoverPartialStructuredBlocks(options: {
    slots: readonly GeminiPartialStructuredSlot[];
    markdownIndex: CandidateMarkdownIndex;
    sourceCitations?: GeminiSourceCitations;
    sourceAttributions?: readonly GeminiSourceAttribution[];
    groundingCitationMarkers?: readonly string[];
    context: GeminiStructuredContext;
}): PartialStructuredRecoveryResult | null {
    const { slots, markdownIndex, sourceCitations, sourceAttributions = [], groundingCitationMarkers, context } = options;
    if (slots.length < 2) return null;

    type Item =
        | { kind: 'anchor'; block: BlockNode; sig: string }
        | { kind: 'card'; blocks: BlockNode[] }
        | { kind: 'rejected' };

    const items: Item[] = [];
    let sourceRangesRecovered = 0;
    const sourceFailures: GeminiSourceFailure[] = [];
    let nativeBlocksRetained = 0;

    for (const slot of slots) {
        if (slot.kind === 'rejected') {
            items.push({ kind: 'rejected' });
            continue;
        }
        const recovery = recoverGeminiSourceRanges({ children: [slot.node] }, sourceAttributions, markdownIndex);
        const slotFailures: GeminiSourceFailure[] = [];
        const converted = geminiStructuredToContent(recovery.document, sourceCitations, {
            ...context,
            diagnostics: [],
            onSourceFallback: failure => { slotFailures.push(failure); },
        });
        if (converted === null) {
            items.push({ kind: 'rejected' });
            continue;
        }
        sourceRangesRecovered += recovery.recovered;
        sourceFailures.push(...slotFailures);
        if (converted.length === 0) continue;

        if (isCardOrAttachmentNode(slot.node)) {
            items.push({ kind: 'card', blocks: converted });
            nativeBlocksRetained += converted.length;
            continue;
        }

        for (const block of converted) {
            const sig = blockAnchorSignature(block);
            if (sig === null) return null;
            items.push({ kind: 'anchor', block, sig });
            nativeBlocksRetained++;
        }
    }

    if (!items.some(item => item.kind === 'rejected') || nativeBlocksRetained === 0) return null;

    const markdownBlocks = markdownIndex.referenceBlocks(context);
    const anchors = items.filter((item): item is Extract<Item, { kind: 'anchor' }> => item.kind === 'anchor');

    // Without at least one prose/code anchor, only an empty fallback Markdown
    // allows retaining standalone native cards unambiguously.
    if (anchors.length === 0) {
        if (markdownBlocks.length > 0) return null;
        const cardOnly = items.flatMap(item => item.kind === 'card' ? item.blocks : []);
        return cardOnly.length ? { blocks: cardOnly, sourceRangesRecovered, sourceFailures, nativeBlocksRetained } : null;
    }

    const mdSigs = markdownBlocks.map(block => blockAnchorSignature(block, groundingCitationMarkers));
    const matchedIndices = uniqueMonotonicAnchors(anchors.map(a => a.sig), mdSigs);
    if (!matchedIndices) return null;

    const assembled: BlockNode[] = [];
    let itemCursor = 0;
    for (let anchorIdx = 0; anchorIdx <= anchors.length; anchorIdx++) {
        const mdStart = anchorIdx === 0 ? 0 : matchedIndices[anchorIdx - 1] + 1;
        const mdEnd = anchorIdx === anchors.length ? markdownBlocks.length : matchedIndices[anchorIdx];
        const mdSlice = markdownBlocks.slice(mdStart, mdEnd);

        const intervalCards: BlockNode[] = [];
        let intervalHasRejected = false;
        while (itemCursor < items.length && items[itemCursor].kind !== 'anchor') {
            const current = items[itemCursor++];
            if (current.kind === 'card') intervalCards.push(...current.blocks);
            else if (current.kind === 'rejected') intervalHasRejected = true;
        }

        if (!intervalHasRejected) {
            if (mdSlice.length > 0) return null;
            assembled.push(...intervalCards);
        } else if (mdSlice.length === 0) {
            assembled.push(...intervalCards);
        } else {
            // If both unanchored native cards and unmatched Markdown blocks occupy
            // the same gap, their relative order is unproven -> refuse assembly.
            if (intervalCards.length > 0) return null;
            assembled.push(...structuredClone(mdSlice));
        }

        if (anchorIdx < anchors.length) {
            const anchorItem = items[itemCursor++];
            if (anchorItem?.kind !== 'anchor') return null;
            assembled.push(anchorItem.block);
        }
    }

    return { blocks: assembled, sourceRangesRecovered, sourceFailures, nativeBlocksRetained };
}
