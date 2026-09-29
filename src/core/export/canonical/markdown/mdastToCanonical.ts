/**
 * src/core/export/canonical/markdown/mdastToCanonical.ts
 *
 * Pure adapter from MDAST (mdast-util-from-markdown) to Canonical AST (blocks.ts, inline.ts).
 *
 * Responsibilities:
 * - Maps MDAST Root/BlockContent nodes to Canonical BlockNode[].
 * - Maps MDAST PhrasingContent nodes to Canonical InlineNode[].
 * - Wires Gemini-specific asset linking via linkInlineImage().
 * - Emits required Canonical diagnostics (MATH_FENCE_UNCLOSED, MATH_BLOCK_EMPTY).
 * - Preserves soft and hard line breaks according to Canonical schema.
 */

import type {
    Root,
    RootContent,
    BlockContent,
    PhrasingContent,
    Paragraph,
    Heading,
    ThematicBreak,
    Blockquote,
    List,
    ListItem as MdastListItem,
    Table,
    TableRow as MdastTableRow,
    TableCell as MdastTableCell,
    Code,
    HTML,
    Text,
    Emphasis,
    Strong,
    Delete,
    InlineCode as MdastInlineCode,
    Link,
    Image,
    Break,
} from 'mdast';
import type { InlineMath, Math as MdastMath } from 'mdast-util-math';
import type {
    BlockNode,
    CodeBlock,
    HeadingBlock,
    ListBlock,
    ListItem,
    MathBlock,
    ParagraphBlock,
    QuoteBlock,
    TableAlignment,
    TableBlock,
    TableColumn,
    TableRow,
    ThematicBreakBlock,
} from '../blocks.js';
import type {
    ImageInline,
    InlineCode,
    InlineNode,
    LineBreakInline,
    LinkInline,
    StrikethroughInline,
    StrongInline,
    EmphasisInline,
    TextInline,
} from '../inline.js';
import type { JsonValue } from '../json.js';
import type { Diagnostic } from '../diagnostics.js';
import type { SourceRef } from '../provenance.js';
import {
    type AssetParserContext,
    linkInlineImage,
} from '../gemini/normalizeAssets.js';

export interface MarkdownParseContext extends AssetParserContext {
    nextBlockId: () => string;
}

/**
 * Coalesce consecutive TextInline nodes within the inline tree.
 */
export function mergeAdjacentTextNodes(nodes: InlineNode[]): InlineNode[] {
    const result: InlineNode[] = [];
    for (const node of nodes) {
        if ('children' in node && Array.isArray((node as any).children)) {
            const mergedChildren = mergeAdjacentTextNodes((node as any).children);
            result.push({ ...(node as any), children: mergedChildren });
        } else if (node.type === 'text') {
            const prev = result[result.length - 1];
            if (prev && prev.type === 'text') {
                prev.text += node.text;
            } else {
                result.push({ ...node });
            }
        } else {
            result.push(node);
        }
    }
    return result;
}

/**
 * Converts a text string containing newlines into TextInline and soft LineBreakInline nodes.
 */
function textWithSoftBreaks(text: string): InlineNode[] {
    if (!text.includes('\n')) {
        return text ? [{ type: 'text', text }] : [];
    }
    const lines = text.split('\n');
    const nodes: InlineNode[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (i > 0) {
            nodes.push({ type: 'lineBreak', kind: 'soft' });
        }
        if (lines[i].length > 0) {
            nodes.push({ type: 'text', text: lines[i] });
        }
    }
    return nodes;
}

/**
 * Adapt a single MDAST PhrasingContent node to Canonical InlineNode[].
 */
export function adaptPhrasingNode(
    node: PhrasingContent,
    ctx: MarkdownParseContext,
): InlineNode[] {
    switch (node.type) {
        case 'text':
            return textWithSoftBreaks(node.value);

        case 'strong': {
            const children = adaptInlines(node.children, ctx);
            return [{ type: 'strong', children }];
        }

        case 'emphasis': {
            const children = adaptInlines(node.children, ctx);
            return [{ type: 'emphasis', children }];
        }

        case 'delete': {
            const children = adaptInlines(node.children, ctx);
            return [{ type: 'strikethrough', children }];
        }

        case 'inlineCode':
            return [{ type: 'inlineCode', code: node.value }];

        case 'link': {
            const children = adaptInlines(node.children, ctx);
            const linkNode: LinkInline = {
                type: 'link',
                href: node.url,
                ...(node.title ? { title: node.title } : {}),
                children,
            };
            return [linkNode];
        }

        case 'image': {
            const linked = linkInlineImage(node.url, node.alt || '', node.title || undefined, ctx);
            return [linked];
        }

        case 'break':
            return [{ type: 'lineBreak', kind: 'hard' }];

        case 'html': {
            if (/<br\s*\/?>/i.test(node.value)) {
                return [{ type: 'lineBreak', kind: 'hard' }];
            }
            return textWithSoftBreaks(node.value);
        }

        case 'inlineMath': {
            const val = (node as unknown as InlineMath).value || '';
            if (val.startsWith(' ') || val.endsWith(' ')) {
                return textWithSoftBreaks(`$${val}$`);
            }
            return [{
                type: 'inlineMath',
                source: val,
                notation: 'latex',
            }];
        }

        default:
            if ('value' in node && typeof (node as any).value === 'string') {
                return textWithSoftBreaks((node as any).value);
            }
            return [];
    }
}

/**
 * Adapt an array of MDAST PhrasingContent nodes into Canonical InlineNode[].
 */
export function adaptInlines(
    nodes: PhrasingContent[],
    ctx: MarkdownParseContext,
): InlineNode[] {
    const raw: InlineNode[] = [];
    for (const n of nodes) {
        raw.push(...adaptPhrasingNode(n, ctx));
    }
    return mergeAdjacentTextNodes(raw);
}

/**
 * Adapt a TableCell to Canonical { children: InlineNode[] }.
 */
function adaptTableCell(cell: MdastTableCell, ctx: MarkdownParseContext): { children: InlineNode[] } {
    return {
        children: adaptInlines(cell.children, ctx),
    };
}

/**
 * Adapt a TableRow to Canonical TableRow.
 */
function adaptTableRow(row: MdastTableRow, ctx: MarkdownParseContext): TableRow {
    return {
        cells: row.children.map((c) => adaptTableCell(c, ctx)),
    };
}

/**
 * Adapt a List item to Canonical ListItem.
 */
function adaptListItem(
    item: MdastListItem,
    ctx: MarkdownParseContext,
    rawMarkdown: string,
): ListItem {
    const blocks = adaptBlockNodes(item.children, ctx, rawMarkdown);

    // If GFM task list checkbox is present, prepend checkbox marker to first inline text
    if (item.checked !== null && item.checked !== undefined && blocks.length > 0) {
        const marker = item.checked ? '[x] ' : '[ ] ';
        const firstBlock = blocks[0];
        if (firstBlock.type === 'paragraph' && firstBlock.children.length > 0) {
            if (firstBlock.children[0].type === 'text') {
                firstBlock.children[0].text = marker + firstBlock.children[0].text;
            } else {
                firstBlock.children.unshift({ type: 'text', text: marker });
            }
        }
    }

    return { blocks };
}

/**
 * Checks if a standalone paragraph is actually a display math formula ($$...$$).
 */
function tryExtractDisplayMathParagraph(
    para: Paragraph,
    ctx: MarkdownParseContext,
    rawMarkdown: string,
): MathBlock | null {
    if (para.children.length !== 1) return null;
    const child = para.children[0];
    if (child.type !== 'inlineMath') return null;

    // Check if the original slice in raw markdown started with '$$'
    const pos = child.position;
    if (pos && pos.start.offset !== undefined) {
        const rawSlice = rawMarkdown.slice(pos.start.offset, pos.start.offset + 2);
        if (rawSlice === '$$') {
            const mathBlockId = ctx.nextBlockId();
            const source = (child as unknown as InlineMath).value || '';
            if (!source.trim()) {
                ctx.diagnostics.push({
                    id: `math-empty:${mathBlockId}`,
                    severity: 'warning',
                    code: 'MATH_BLOCK_EMPTY',
                    message: 'empty display-math fence; kept as source evidence',
                    sourceRef: ctx.sourceRef,
                });
            }
            return {
                id: mathBlockId,
                type: 'math',
                source,
                notation: 'latex',
                ...(ctx.sourceRef ? { sourceRef: ctx.sourceRef } : {}),
            };
        }
    }
    return null;
}

/**
 * Adapt a single MDAST block content node to Canonical BlockNode[].
 */
export function adaptBlockNode(
    node: RootContent,
    ctx: MarkdownParseContext,
    rawMarkdown: string,
): BlockNode[] {
    switch (node.type) {
        case 'paragraph': {
            const mathBlock = tryExtractDisplayMathParagraph(node, ctx, rawMarkdown);
            if (mathBlock) return [mathBlock];

            const children = adaptInlines(node.children, ctx);
            if (children.length === 0) return [];
            return [{
                id: ctx.nextBlockId(),
                type: 'paragraph',
                children,
                ...(ctx.sourceRef ? { sourceRef: ctx.sourceRef } : {}),
            }];
        }

        case 'heading': {
            const level = Math.min(6, Math.max(1, node.depth)) as 1 | 2 | 3 | 4 | 5 | 6;
            return [{
                id: ctx.nextBlockId(),
                type: 'heading',
                level,
                children: adaptInlines(node.children, ctx),
                ...(ctx.sourceRef ? { sourceRef: ctx.sourceRef } : {}),
            }];
        }

        case 'thematicBreak':
            return [{
                id: ctx.nextBlockId(),
                type: 'thematicBreak',
                ...(ctx.sourceRef ? { sourceRef: ctx.sourceRef } : {}),
            }];

        case 'blockquote':
            return [{
                id: ctx.nextBlockId(),
                type: 'quote',
                blocks: adaptBlockNodes(node.children, ctx, rawMarkdown),
                ...(ctx.sourceRef ? { sourceRef: ctx.sourceRef } : {}),
            }];

        case 'list': {
            const ordered = Boolean(node.ordered);
            const items = node.children.map((it) => adaptListItem(it, ctx, rawMarkdown));
            return [{
                id: ctx.nextBlockId(),
                type: 'list',
                ordered,
                ...(ordered ? { start: typeof node.start === 'number' ? node.start : 1 } : {}),
                items,
                ...(ctx.sourceRef ? { sourceRef: ctx.sourceRef } : {}),
            }];
        }

        case 'table': {
            const aligns: TableAlignment[] = (node.align || []).map((a) => {
                if (a === 'left') return 'left';
                if (a === 'center') return 'center';
                if (a === 'right') return 'right';
                return 'default';
            });
            const columns: TableColumn[] = aligns.map((align) => ({ align }));
            const headerRows: TableRow[] = node.children.length > 0
                ? [adaptTableRow(node.children[0], ctx)]
                : [];
            const rows: TableRow[] = node.children.slice(1).map((r) => adaptTableRow(r, ctx));
            return [{
                id: ctx.nextBlockId(),
                type: 'table',
                ...(columns.length ? { columns } : {}),
                ...(headerRows.length ? { headerRows } : {}),
                rows,
                ...(ctx.sourceRef ? { sourceRef: ctx.sourceRef } : {}),
            }];
        }

        case 'code': {
            return [{
                id: ctx.nextBlockId(),
                type: 'code',
                code: node.value,
                ...(node.lang ? { language: node.lang } : {}),
                ...(node.meta ? { meta: node.meta } : {}),
                ...(ctx.sourceRef ? { sourceRef: ctx.sourceRef } : {}),
            }];
        }

        case 'math': {
            const mathNode = node as unknown as MdastMath;
            const blockId = ctx.nextBlockId();
            const source = mathNode.value || '';

            const startOffset = node.position?.start?.offset;
            const endOffset = node.position?.end?.offset;
            if (startOffset !== undefined && endOffset !== undefined) {
                const rawSlice = rawMarkdown.slice(startOffset, endOffset).trim();
                if (!rawSlice.endsWith('$$') || rawSlice === '$$') {
                    ctx.diagnostics.push({
                        id: `math-fence-unclosed:${blockId}`,
                        severity: 'warning',
                        code: 'MATH_FENCE_UNCLOSED',
                        message: 'display-math fence never closed; kept collected lines as the formula source',
                        sourceRef: ctx.sourceRef,
                        details: { line: rawSlice.slice(0, 80) } as JsonValue,
                    });
                }
            }

            if (!source.trim()) {
                const preview = startOffset !== undefined ? rawMarkdown.slice(startOffset, startOffset + 80) : '';
                ctx.diagnostics.push({
                    id: `math-empty:${blockId}`,
                    severity: 'warning',
                    code: 'MATH_BLOCK_EMPTY',
                    message: 'empty display-math fence; kept as source evidence',
                    sourceRef: ctx.sourceRef,
                    details: { line: preview } as JsonValue,
                });
            }

            return [{
                id: blockId,
                type: 'math',
                source,
                notation: 'latex',
                ...(ctx.sourceRef ? { sourceRef: ctx.sourceRef } : {}),
            }];
        }

        case 'html': {
            if (/<hr\s*\/?>/i.test(node.value)) {
                return [{
                    id: ctx.nextBlockId(),
                    type: 'thematicBreak',
                    ...(ctx.sourceRef ? { sourceRef: ctx.sourceRef } : {}),
                }];
            }
            const children = textWithSoftBreaks(node.value);
            if (children.length === 0) return [];
            return [{
                id: ctx.nextBlockId(),
                type: 'paragraph',
                children,
                ...(ctx.sourceRef ? { sourceRef: ctx.sourceRef } : {}),
            }];
        }

        default:
            return [];
    }
}

/**
 * Adapt an array of MDAST block content nodes to Canonical BlockNode[].
 */
export function adaptBlockNodes(
    nodes: RootContent[],
    ctx: MarkdownParseContext,
    rawMarkdown: string,
): BlockNode[] {
    const blocks: BlockNode[] = [];
    for (const n of nodes) {
        blocks.push(...adaptBlockNode(n, ctx, rawMarkdown));
    }
    return blocks;
}

/**
 * Top-level adapter: converts an MDAST Root to Canonical BlockNode[].
 */
export function mdastRootToBlocks(
    root: Root,
    ctx: MarkdownParseContext,
    rawMarkdown: string,
): BlockNode[] {
    return adaptBlockNodes(root.children, ctx, rawMarkdown);
}
