/**
 * src/core/export/canonical/unknownFallback.ts
 * Readable fallbacks for unknown content.
 *
 * Implements integration doc section 3, item 3 ("unknown content"): canonical
 * keeps the original evidence (rawRef/payload); the render view must always
 * have visible fallback text or an explicit diagnostic. Unknown blocks are
 * never swallowed as blank gaps.
 */

import type { BlockNode, UnknownBlock } from './blocks.js';
import type { Diagnostic } from './diagnostics.js';
import type { InlineNode, UnknownInline } from './inline.js';

export interface UnknownRenderFallback {
    /** Always non-empty, human-readable text for the render view. */
    text: string;
    /** Explicit diagnostic describing what was preserved and what degraded. */
    diagnostic: Diagnostic;
}

function blockDiagnosticId(block: UnknownBlock): string {
    return `unknown-fallback:${block.id}`;
}

export function unknownBlockFallbackText(block: UnknownBlock): string {
    const fromBlocks = block.fallbackBlocks
        ?.map((b) => extractBlockText(b))
        .filter((t) => t.trim())
        .join('\n')
        .trim();
    if (fromBlocks) return fromBlocks;
    const parts = [`[Unknown content: ${block.sourceType}]`];
    if (block.rawRef) parts.push(`(archived evidence: ${block.rawRef})`);
    return parts.join(' ');
}

export function unknownInlineFallbackText(inline: UnknownInline): string {
    if (inline.fallbackText && inline.fallbackText.trim()) return inline.fallbackText;
    return `[Unknown inline content: ${inline.sourceType}]`;
}

/**
 * Convert an UnknownBlock into renderable fallback blocks plus a diagnostic.
 * Guarantees: the returned blocks are never empty.
 */
export function unknownBlockToFallbackBlocks(block: UnknownBlock): { blocks: BlockNode[]; diagnostic: Diagnostic } {
    const text = unknownBlockFallbackText(block);
    const fallbackBlocks: BlockNode[] = block.fallbackBlocks && block.fallbackBlocks.length > 0
        ? block.fallbackBlocks
        : [{ id: `${block.id}-fallback`, type: 'paragraph', children: [{ type: 'text', text }] }];
    const diagnostic: Diagnostic = {
        id: blockDiagnosticId(block),
        severity: 'warning',
        code: 'UNKNOWN_FALLBACK',
        message: `unknown block rendered as readable fallback (sourceType=${block.sourceType})`,
        sourceRef: block.sourceRef,
        details: { rawRef: block.rawRef ?? null, hadPayload: block.payload !== undefined },
    };
    return { blocks: fallbackBlocks, diagnostic };
}

/**
 * Best-effort plain text extraction used to surface fallback content.
 * Never throws; returns '' when nothing readable exists.
 */
export function extractBlockText(block: BlockNode): string {
    try {
        switch (block.type) {
            case 'paragraph':
            case 'heading':
                return (block.children ?? []).map(extractInlineText).join('');
            case 'list':
                return (block.items ?? []).map((i) => (i.blocks ?? []).map(extractBlockText).join('\n')).join('\n');
            case 'quote':
            case 'thought':
                return (block.blocks ?? []).map(extractBlockText).join('\n');
            case 'code':
                return block.code ?? '';
            case 'math':
                return block.source ?? '';
            case 'table': {
                const rows = [...(block.headerRows ?? []), ...(block.rows ?? [])];
                return rows.map((r) => (r.cells ?? []).map((c) => (c.children ?? []).map(extractInlineText).join('')).join(' | ')).join('\n');
            }
            case 'image':
                return block.alt ?? '';
            case 'file':
                return block.label ?? '';
            case 'citationGroup':
                return (block.title ?? []).map(extractInlineText).join('');
            case 'toolCall':
            case 'toolResult':
                return (block.displayBlocks ?? []).map(extractBlockText).join('\n');
            case 'thematicBreak':
                return '';
            case 'unknown':
                return unknownBlockFallbackText(block);
            default:
                return '';
        }
    } catch {
        return '';
    }
}

export function extractInlineText(inline: InlineNode): string {
    try {
        switch (inline.type) {
            case 'text':
                return inline.text ?? '';
            case 'strong':
            case 'emphasis':
            case 'strikethrough':
                return (inline.children ?? []).map(extractInlineText).join('');
            case 'inlineCode':
                return inline.code ?? '';
            case 'link':
                return (inline.children ?? []).map(extractInlineText).join('');
            case 'inlineMath':
                return inline.source ?? '';
            case 'citationRef':
                return inline.label ?? '';
            case 'lineBreak':
                return '\n';
            case 'unknownInline':
                return unknownInlineFallbackText(inline);
            default:
                return '';
        }
    } catch {
        return '';
    }
}
