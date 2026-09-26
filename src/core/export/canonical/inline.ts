import type { ProviderExtensions } from './json.js';

export type MathNotation = 'latex' | 'mathml' | 'asciimath' | 'plain' | 'unknown';

export type InlineNode =
    | TextInline
    | StrongInline
    | EmphasisInline
    | StrikethroughInline
    | InlineCode
    | LinkInline
    | ImageInline
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

export interface ImageInline {
    type: 'image';
    assetId: string;
    alt?: string;
    title?: string;
}

export interface InlineMath {
    type: 'inlineMath';
    source: string;
    notation: MathNotation;
}

export interface CitationRefInline {
    type: 'citationRef';
    citationId: string;
    label?: string;
}

export interface LineBreakInline {
    type: 'lineBreak';
    kind: 'soft' | 'hard';
}

export interface UnknownInline {
    type: 'unknownInline';
    sourceType: string;
    fallbackText?: string;
    rawRef?: string;
    extensions?: ProviderExtensions;
}
