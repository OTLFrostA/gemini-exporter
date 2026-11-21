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
    | LineBreakInline;

interface TextInline {
    type: 'text';
    text: string;
}

interface StrongInline {
    type: 'strong';
    children: InlineNode[];
}

interface EmphasisInline {
    type: 'emphasis';
    children: InlineNode[];
}

interface StrikethroughInline {
    type: 'strikethrough';
    children: InlineNode[];
}

interface InlineCode {
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

interface InlineMath {
    type: 'inlineMath';
    source: string;
}

interface CitationRefInline {
    type: 'citationRef';
    citationId: string;
    label?: string;
}

interface LineBreakInline {
    type: 'lineBreak';
    kind: 'soft' | 'hard';
}
