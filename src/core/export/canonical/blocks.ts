import type { InlineNode, MathNotation } from './inline.js';
import type { JsonValue, ProviderExtensions } from './json.js';
import type { SourceRef } from './provenance.js';

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
    | CitationGroupBlock
    | ThoughtBlock
    | ToolCallBlock
    | ToolResultBlock
    | ThematicBreakBlock
    | UnknownBlock;

export interface BlockBase {
    id: string;
    sourceRef?: SourceRef;
    extensions?: ProviderExtensions;
}

export interface ParagraphBlock extends BlockBase {
    type: 'paragraph';
    children: InlineNode[];
}

export interface HeadingBlock extends BlockBase {
    type: 'heading';
    level: 1 | 2 | 3 | 4 | 5 | 6;
    children: InlineNode[];
}

export interface ListItem {
    blocks: BlockNode[];
}

export interface ListBlock extends BlockBase {
    type: 'list';
    ordered: boolean;
    start?: number;
    items: ListItem[];
}

export interface QuoteBlock extends BlockBase {
    type: 'quote';
    blocks: BlockNode[];
}

export interface CodeBlock extends BlockBase {
    type: 'code';
    code: string;
    language?: string;
    meta?: string;
    filename?: string;
}

export interface MathBlock extends BlockBase {
    type: 'math';
    source: string;
    notation: MathNotation;
}

export type TableAlignment = 'left' | 'center' | 'right' | 'default';

export interface TableColumn {
    align?: TableAlignment;
}

export interface TableCell {
    children: InlineNode[];
    colSpan?: number;
    rowSpan?: number;
}

export interface TableRow {
    cells: TableCell[];
}

export interface TableBlock extends BlockBase {
    type: 'table';
    caption?: InlineNode[];
    columns?: TableColumn[];
    headerRows?: TableRow[];
    rows: TableRow[];
}

export type AssetOrigin =
    | 'inline'
    | 'attachment'
    | 'generated'
    | 'citation'
    | 'tool'
    | 'unknown';

export interface ImageBlock extends BlockBase {
    type: 'image';
    assetId: string;
    alt?: string;
    caption?: InlineNode[];
    origin?: AssetOrigin;
}

export interface FileBlock extends BlockBase {
    type: 'file';
    assetId: string;
    label?: string;
    description?: InlineNode[];
    origin?: AssetOrigin;
}

export interface CitationGroupBlock extends BlockBase {
    type: 'citationGroup';
    citationIds: string[];
    title?: InlineNode[];
}

export interface ThoughtBlock extends BlockBase {
    type: 'thought';
    disclosure: 'providerExposed';
    kind?: 'summary' | 'progress' | 'reasoning' | 'unknown';
    blocks: BlockNode[];
}

export interface ToolCallBlock extends BlockBase {
    type: 'toolCall';
    callId: string;
    toolName: string;
    input?: JsonValue;
    displayBlocks?: BlockNode[];
    status?: 'pending' | 'running' | 'completed' | 'failed';
}

export interface ToolResultBlock extends BlockBase {
    type: 'toolResult';
    callId: string;
    toolName?: string;
    output?: JsonValue;
    displayBlocks?: BlockNode[];
    assetIds?: string[];
    status?: 'completed' | 'failed';
}

export interface ThematicBreakBlock extends BlockBase {
    type: 'thematicBreak';
}

/** At least one of fallbackBlocks, rawRef, or payload must be present so unknown content is never silently dropped. */
export interface UnknownBlock extends BlockBase {
    type: 'unknown';
    sourceType: string;
    fallbackBlocks?: BlockNode[];
    rawRef?: string;
    payload?: JsonValue;
}
