import type { JsonValue } from '../../../../shared/utils/jsonTypes.js';
import type { GeminiMathBlockNode as GeminiMathBlockNodeType, GeminiOrderedListNode as GeminiOrderedListNodeType, GeminiTextNode as GeminiTextNodeType } from './structuredTypes.js';

export const GEMINI_NODE_TYPES: {
    readonly ATTACHMENT: 0;
    readonly CODE_BLOCK: 1;
    readonly MATH_BLOCK: 12;
    readonly LINE_BREAK: 13;
    readonly ORDERED_LIST: 14;
    readonly BLOCKQUOTE: 15;
    readonly TABLE: 17;
    readonly TEXT_BLOCK: 18;
    readonly THEMATIC_BREAK: 19;
    readonly UNORDERED_LIST: 20;
    readonly GENERATED_FILE: 24;
} = {
    ATTACHMENT: 0,
    CODE_BLOCK: 1,
    MATH_BLOCK: 12,
    LINE_BREAK: 13,
    ORDERED_LIST: 14,
    BLOCKQUOTE: 15,
    TABLE: 17,
    TEXT_BLOCK: 18,
    THEMATIC_BREAK: 19,
    UNORDERED_LIST: 20,
    GENERATED_FILE: 24,
};

export const GEMINI_ANNOTATION_TYPES: {
    readonly STRONG: 0;
    readonly EMPHASIS: 2;
    readonly INLINE_MATH: 4;
    readonly SUBTLE_EMPHASIS: 5;
    readonly LINK: 6;
    readonly INLINE_CODE: 7;
    readonly STRIKETHROUGH: 12;
} = {
    STRONG: 0,
    EMPHASIS: 2,
    INLINE_MATH: 4,
    SUBTLE_EMPHASIS: 5,
    LINK: 6,
    INLINE_CODE: 7,
    STRIKETHROUGH: 12,
};

export interface Citation {
    url: string;
    title: string;
}

/** Candidate-local source IDs; never search other candidates or turns for a match. */
export interface GeminiSourceAttribution {
    sourceId: string;
    sources: Citation[];
    /** Present only after both wire byte/UTF-16 ranges verify the selected Markdown. */
    quote?: { text: string; start: number; end: number };
}

export interface ImageAttachment {
    /** JSON-serialized matched wire tuple; never an unvalidated runtime value. */
    sourceEvidence?: { detectorKind: string; node: JsonValue };
    isGenerated?: boolean;
    providerRequestId?: string;
    imageOrdinal?: number;
    sourceUrl: string;
    width?: number;
    height?: number;
    size?: number;
    token?: string;
    fileName?: string;
    title?: string;
    mimeType?: string;
}

export type GeminiAnnotation = { start: number; end: number } & (
    | { type: 0 | 2 | 4 | 5 | 7 | 12 }
    | { type: 6; url: string }
    | { type: 'source'; sourceIds: string[] }
);

export interface GeminiTextNode {
    nodeType: 18;
    text: string;
    /** Heading level 1..6, or 0/undefined for paragraph (legacy runtime field name retained for fixture compatibility). */
    jJ?: number;
    annotations?: GeminiAnnotation[];
}

export interface GeminiMathBlockNode {
    nodeType: 12;
    /** Display LaTeX source (legacy runtime field name retained for fixture compatibility). */
    FTa: string;
}

export interface GeminiCodeBlockNode {
    nodeType: 1;
    code: string;
    info?: string;
}

export interface GeminiThematicBreakNode {
    nodeType: 19;
}

export interface GeminiLineBreakNode {
    nodeType: 13;
}

export interface GeminiTableCell {
    children: GeminiStructuredNode[];
    colSpan?: number;
    rowSpan?: number;
}

export interface GeminiTableRow {
    cells: GeminiTableCell[];
}

export interface GeminiTableNode {
    nodeType: 17;
    rows: GeminiTableRow[];
}

export interface GeminiListItem {
    children: GeminiStructuredNode[];
}

export interface GeminiUnorderedListNode {
    nodeType: 20;
    items: GeminiListItem[];
}

export interface GeminiOrderedListNode {
    nodeType: 14;
    items: GeminiListItem[];
    /** 1-based start number (legacy runtime field name retained for fixture compatibility). */
    VHa?: number;
}

export interface GeminiQuoteNode {
    nodeType: 15;
    children: GeminiStructuredNode[];
}

export interface GeminiAttachmentNode {
    nodeType: 0;
    /** Resource facts are decoded at attachment ingress, before typed traversal. */
    images?: ImageAttachment[];
}

export interface GeminiFileNode { nodeType: 24; id: string; title: string }

/** Field 13 groups inline fragments into a text block. The contained text
 * declares paragraph/heading semantics; the group itself is not a line break. */
export interface GeminiCompositeParagraph { nodeType: 'paragraph'; children: GeminiStructuredNode[] }
/** A provider container with block children and no extra quote/list semantics. */
export interface GeminiStructuredFragment { nodeType: 'fragment'; children: GeminiStructuredNode[] }
export interface GeminiMarkupNode { nodeType: 'markup'; format: 'html' | 'markdown'; source: string }
export interface GeminiFileCitation { nodeType: 'citation'; number: number; title: string; url?: string }
export interface GeminiCitationGroup { nodeType: 'citationGroup'; children: GeminiFileCitation[] }
export interface GeminiCitationSource { title: string; url?: string }
/** Excerpt locations can outnumber files, or use compound source identifiers. */
export interface GeminiSourceReference { nodeType: 'sourceReference'; marker: string; sources: GeminiCitationSource[] }

export type GeminiCitationReference = GeminiFileCitation | GeminiCitationGroup | GeminiSourceReference;

export type GeminiStructuredNode =
    | GeminiStructuredFragment
    | GeminiMarkupNode
    | GeminiCompositeParagraph
    | GeminiFileCitation
    | GeminiCitationGroup
    | GeminiSourceReference
    | GeminiTextNode
    | GeminiMathBlockNode
    | GeminiCodeBlockNode
    | GeminiThematicBreakNode
    | GeminiLineBreakNode
    | GeminiTableNode
    | GeminiUnorderedListNode
    | GeminiOrderedListNode
    | GeminiQuoteNode
    | GeminiAttachmentNode
    | GeminiFileNode;

export interface GeminiStructuredDocument {
    children: GeminiStructuredNode[];
}

export type GeminiPartialStructuredSlot =
    | { kind: 'decoded'; node: GeminiStructuredNode }
    | { kind: 'rejected' };

/** Transient source input; local ordering and source routes are not durable Domain facts. */
export interface GeminiIndexObservationInput {
    id?: string;
    title?: string;
    titleSource?: string;
    createdAt?: number;
    updatedAt?: number;
    url?: string;
    messageCount?: number;
    sidebarIndex?: number;
}

export function headingLevelOf(node: GeminiTextNodeType): number | undefined {
    return node.jJ;
}

export function mathSourceOf(node: GeminiMathBlockNodeType): string {
    return node.FTa;
}

export function orderedListStartOf(node: GeminiOrderedListNodeType): number {
    return node.VHa ?? 1;
}
