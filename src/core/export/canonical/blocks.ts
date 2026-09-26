/**
 * src/core/export/canonical/blocks.ts
 * Canonical block AST node model.
 *
 * Adapted from gemini-exporter-rendering-contract-v1 (canonical/src/blocks.ts),
 * v1.0.0-draft. See SOURCE.md for the source trace and adaptations.
 *
 * Adaptation note (integration doc section 3, "representation independence"):
 * the package's ThoughtBlock.initiallyCollapsed was view state, not content.
 * It is removed from the canonical type and lives in the renderer config
 * (see rendering.ts: ThoughtRenderOptions).
 */

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
    /** Stable/deterministic within a conversation whenever possible. */
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
    /**
     * Block children allow nested lists and multi-paragraph list items without
     * turning the AST into provider HTML.
     */
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
    /** Fence/provider metadata, not renderer styling. */
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
    /** v1 intentionally keeps table cells inline-only. */
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

/** Standalone provider/source section. Inline citations use citationRef. */
export interface CitationGroupBlock extends BlockBase {
    type: 'citationGroup';
    citationIds: string[];
    title?: InlineNode[];
}

/**
 * Only provider-exposed thought/reasoning/progress content belongs here.
 * Hidden/internal chain-of-thought must never be synthesized into this node.
 *
 * View state (e.g. collapsed-by-default) is NOT canonical; see
 * ThoughtRenderOptions in rendering.ts.
 */
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

/** Compatibility addition for Markdown/HTML parity. */
export interface ThematicBreakBlock extends BlockBase {
    type: 'thematicBreak';
}

/**
 * Forward-compatibility escape hatch. Unknown content must never disappear.
 * At least one of fallbackBlocks/rawRef/payload should be present.
 */
export interface UnknownBlock extends BlockBase {
    type: 'unknown';
    sourceType: string;
    fallbackBlocks?: BlockNode[];
    rawRef?: string;
    payload?: JsonValue;
}
