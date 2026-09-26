import type { BlockNode, UnknownBlock } from './blocks.js';
import type { Diagnostic } from './diagnostics.js';
import type { InlineNode, UnknownInline } from './inline.js';

export interface UnknownRenderFallback {
    text: string;
    diagnostic: Diagnostic;
}

export interface TextExtractOptions {
    citationLabel?: (citationId: string) => string | undefined;
}

export function unknownBlockFallbackText(block: UnknownBlock, options?: TextExtractOptions): string {
    const fromBlocks = block.fallbackBlocks
        ?.map((b) => extractBlockText(b, options))
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

export function extractBlockText(block: BlockNode, options?: TextExtractOptions): string {
    try {
        switch (block.type) {
            case 'paragraph':
            case 'heading':
                return (block.children ?? []).map((i) => extractInlineText(i, options)).join('');
            case 'list':
                return (block.items ?? []).map((i) => (i.blocks ?? []).map((b) => extractBlockText(b, options)).join('\n')).join('\n');
            case 'quote':
            case 'thought':
                return (block.blocks ?? []).map((b) => extractBlockText(b, options)).join('\n');
            case 'code':
                return block.code ?? '';
            case 'math':
                return block.source ?? '';
            case 'table': {
                const rows = [...(block.headerRows ?? []), ...(block.rows ?? [])];
                return rows.map((r) => (r.cells ?? []).map((c) => (c.children ?? []).map((i) => extractInlineText(i, options)).join('')).join(' | ')).join('\n');
            }
            case 'image':
                return block.alt ?? '';
            case 'file':
                return block.label ?? '';
            case 'citationGroup':
                return (block.title ?? []).map((i) => extractInlineText(i, options)).join('');
            case 'toolCall':
            case 'toolResult':
                return (block.displayBlocks ?? []).map((b) => extractBlockText(b, options)).join('\n');
            case 'thematicBreak':
                return '';
            case 'unknown':
                return unknownBlockFallbackText(block, options);
            default:
                return '';
        }
    } catch {
        return '';
    }
}

export function extractInlineText(inline: InlineNode, options?: TextExtractOptions): string {
    try {
        switch (inline.type) {
            case 'text':
                return inline.text ?? '';
            case 'strong':
            case 'emphasis':
            case 'strikethrough':
                return (inline.children ?? []).map((i) => extractInlineText(i, options)).join('');
            case 'inlineCode':
                return inline.code ?? '';
            case 'image':
                return inline.alt ?? '';
            case 'link':
                return (inline.children ?? []).map((i) => extractInlineText(i, options)).join('');
            case 'inlineMath':
                return inline.source ?? '';
            case 'citationRef':
                return inline.label ?? options?.citationLabel?.(inline.citationId) ?? '';
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
