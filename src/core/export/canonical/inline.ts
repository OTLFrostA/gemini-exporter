/**
 * src/core/export/canonical/inline.ts
 * Canonical inline AST node model.
 *
 * Adapted from gemini-exporter-rendering-contract-v1 (canonical/src/inline.ts),
 * v1.0.0-draft. See SOURCE.md for the source trace and adaptations.
 */

import type { ProviderExtensions } from './json.js';

export type MathNotation = 'latex' | 'mathml' | 'asciimath' | 'plain' | 'unknown';

export type InlineNode =
    | TextInline
    | StrongInline
    | EmphasisInline
    | StrikethroughInline
    | InlineCode
    | LinkInline
    | InlineMath
    | CitationRefInline
    | LineBreakInline
    | UnknownInline;

export interface TextInline {
    type: 'text';
    text: string;
}

export interface StrongInline {
    type: 'strong';
    children: InlineNode[];
}

export interface EmphasisInline {
    type: 'emphasis';
    children: InlineNode[];
}

/** Compatibility addition for lossless Markdown/HTML parity. */
export interface StrikethroughInline {
    type: 'strikethrough';
    children: InlineNode[];
}

export interface InlineCode {
    type: 'inlineCode';
    code: string;
}

export interface LinkInline {
    type: 'link';
    href: string;
    title?: string;
    children: InlineNode[];
}

export interface InlineMath {
    type: 'inlineMath';
    source: string;
    notation: MathNotation;
}

export interface CitationRefInline {
    type: 'citationRef';
    citationId: string;
    /** Optional source/provider-visible label; renderers may renumber. */
    label?: string;
}

export interface LineBreakInline {
    type: 'lineBreak';
    kind: 'soft' | 'hard';
}

/**
 * Forward-compatibility escape hatch for inline content. Canonical keeps the
 * original evidence; the renderer contract (unknownFallback.ts) guarantees a
 * readable fallback, so unknown inline content never renders as a blank gap.
 */
export interface UnknownInline {
    type: 'unknownInline';
    sourceType: string;
    fallbackText?: string;
    rawRef?: string;
    extensions?: ProviderExtensions;
}
