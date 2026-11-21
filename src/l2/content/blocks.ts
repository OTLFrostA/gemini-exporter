import type { InlineNode } from './inline.js';

export type BlockNode =
    | ParagraphBlock
    | HeadingBlock
    | ListBlock
    | QuoteBlock
    | CodeBlock
    | MathBlock
    | TableBlock
    | ImageBlock
    | FileBlock
    | ThematicBreakBlock
    | UnknownBlock;

interface ParagraphBlock {
    type: 'paragraph';
    children: InlineNode[];
}

export interface HeadingBlock {
    type: 'heading';
    level: 1 | 2 | 3 | 4 | 5 | 6;
    children: InlineNode[];
}

export interface ListItem {
    blocks: BlockNode[];
}

interface ListBlock {
    type: 'list';
    ordered: boolean;
    start?: number;
    items: ListItem[];
}

interface QuoteBlock {
    type: 'quote';
    blocks: BlockNode[];
}

interface CodeBlock {
    type: 'code';
    code: string;
    language?: string;
    meta?: string;
}

export interface MathBlock {
    type: 'math';
    source: string;
}

type TableAlignment = 'left' | 'center' | 'right';

export interface TableColumn {
    align?: TableAlignment;
}

export interface TableCell {
    children: InlineNode[];
    /** Positive integer, at most 1000; the complete logical grid is also at most 1000 columns. */
    colSpan?: number;
    /** Positive integer, at most 65534. */
    rowSpan?: number;
}

export interface TableRow {
    cells: TableCell[];
}

export interface TableBlock {
    type: 'table';
    caption?: InlineNode[];
    columns?: TableColumn[];
    headerRows?: TableRow[];
    rows: TableRow[];
}

interface ImageBlock {
    type: 'image';
    assetId: string;
    alt?: string;
    caption?: InlineNode[];
}

interface FileBlock {
    type: 'file';
    assetId: string;
    label?: string;
    description?: InlineNode[];
}

interface ThematicBreakBlock {
    type: 'thematicBreak';
}

/** Unsupported content remains visible as plain text. */
export interface UnknownBlock {
    type: 'unknown';
    sourceType: string;
    text: string;
}
