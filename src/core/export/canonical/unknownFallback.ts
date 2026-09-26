import type { BlockNode, UnknownBlock } from './blocks.js';
import type { Diagnostic } from './diagnostics.js';
import type { InlineNode, UnknownInline } from './inline.js';
import type { JsonValue } from './json.js';

export interface UnknownRenderFallback {
    text: string;
    diagnostic: Diagnostic;
}

export interface TextExtractOptions {
    citationLabel?: (citationId: string) => string | undefined;
}

export type UnknownFallbackKind = 'blocks' | 'payload' | 'rawRef' | 'generic';

export interface UnknownBlockFallback {
    kind: UnknownFallbackKind;
    text: string;
    truncated: boolean;
}

const UNKNOWN_PAYLOAD_MAX_DEPTH = 4;
const UNKNOWN_PAYLOAD_MAX_LENGTH = 2000;

function stringifyLimited(value: JsonValue, depth: number): string {
    if (value === null) return 'null';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (depth >= UNKNOWN_PAYLOAD_MAX_DEPTH) return Array.isArray(value) ? '[…]' : '{…}';
    if (Array.isArray(value)) {
        return `[${value.map((v) => stringifyLimited(v as JsonValue, depth + 1)).join(', ')}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}: ${stringifyLimited((value as Record<string, JsonValue>)[k], depth + 1)}`).join(', ')}}`;
}

export function formatUnknownPayload(payload: JsonValue): { text: string; truncated: boolean } {
    let text: string;
    try {
        text = stringifyLimited(payload, 0);
    } catch {
        text = '[unprintable payload]';
    }
    if (text.length > UNKNOWN_PAYLOAD_MAX_LENGTH) {
        return { text: text.slice(0, UNKNOWN_PAYLOAD_MAX_LENGTH) + '…', truncated: true };
    }
    return { text, truncated: false };
}

export function resolveUnknownBlockFallback(block: UnknownBlock): UnknownBlockFallback {
    if (block.fallbackBlocks?.length) {
        return { kind: 'blocks', text: '', truncated: false };
    }
    if (block.payload !== undefined) {
        const { text, truncated } = formatUnknownPayload(block.payload);
        return { kind: 'payload', text, truncated };
    }
    if (block.rawRef) {
        return { kind: 'rawRef', text: `[Unknown content: ${block.sourceType}] (archived evidence: ${block.rawRef})`, truncated: false };
    }
    return { kind: 'generic', text: `[Unknown content: ${block.sourceType}]`, truncated: false };
}

export function unknownBlockFallbackText(block: UnknownBlock, options?: TextExtractOptions): string {
    const fromBlocks = block.fallbackBlocks
        ?.map((b) => extractBlockText(b, options))
        .filter((t) => t.trim())
        .join('\n')
        .trim();
    if (fromBlocks) return fromBlocks;
    return resolveUnknownBlockFallback(block).text;
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
