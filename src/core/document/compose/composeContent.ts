import type { DeepReadonly } from '../../domain/readonly.js';
import type { BlockNode, TableBlock } from '../../domain/content/blocks.js';
import { tableCellPlacements } from '../../domain/content/tableLayout.js';
import type { InlineNode } from '../../domain/content/inline.js';
import type { DomainAsset } from '../../domain/conversationDetail.js';
import { assetPresentation, assetCaptionText, isHumanMeaningfulFilename } from './resourcePresentation.js';
import type { DisplayBlock, DisplayCell, DisplayInline } from '../ast/ast.js';

/** Shared logical content composition; callers provide resolved semantic relationships. */
export function contentComposer(assets: ReadonlyMap<string, DeepReadonly<DomainAsset>>, source: (id: string, explicit?: string) => { id: string; label: string; href?: string }): (nodes: DeepReadonly<BlockNode[]>) => DisplayBlock[] {
    const isTransportAlias = (id: string, value: string | undefined) => value !== undefined && value === assets.get(id)?.name && !isHumanMeaningfulFilename(value);
    const label = (id: string, explicit?: string, fallback = 'Image'): string => (!isTransportAlias(id, explicit) && explicit?.trim()) || assetPresentation(assets.get(id), undefined, fallback).label;
    const inlines = (nodes: DeepReadonly<InlineNode[]>): DisplayInline[] => nodes.map(node => {
        switch (node.type) {
            case 'text': return { type: 'text', text: node.text };
            case 'strong': case 'emphasis': case 'strikethrough': return { type: node.type, children: inlines(node.children) };
            case 'inlineCode': return { type: 'inlineCode', code: node.code };
            case 'link': return { type: 'link', href: node.href, ...(node.title !== undefined ? { title: node.title } : {}), children: inlines(node.children) };
            case 'inlineMath': return { type: 'inlineMath', source: node.source };
            case 'lineBreak': return { type: 'lineBreak', kind: node.kind };
            case 'citationRef': return { type: 'citation', ...source(node.citationId, node.label) };
            case 'image': return { type: 'image', resourceId: node.assetId, alt: label(node.assetId, node.alt), ...(node.title ? { title: node.title } : {}) };
        }
    });
    const table = (node: DeepReadonly<TableBlock>): DisplayBlock => {
        const rows: DisplayCell[][] = [...(node.headerRows ?? []), ...node.rows].map(() => []);
        let width = Math.max(1, node.columns?.length ?? 0);
        for (const { cell, rowIndex, column, colSpan, rowSpan } of tableCellPlacements(node)) {
            rows[rowIndex].push({ column, colSpan, rowSpan, align: node.columns?.[column]?.align ?? 'default', children: inlines(cell.children) });
            width = Math.max(width, column + colSpan);
        }
        return { type: 'table', columnAlignments: Array.from({ length: width }, (_, column) => node.columns?.[column]?.align ?? 'default'), ...(node.caption ? { caption: inlines(node.caption) } : {}), headerRows: rows.slice(0, node.headerRows?.length ?? 0), rows: rows.slice(node.headerRows?.length ?? 0) };
    };
    const blocks = (nodes: DeepReadonly<BlockNode[]>): DisplayBlock[] => nodes.map(node => {
        switch (node.type) {
            case 'paragraph': return { type: 'paragraph', children: inlines(node.children) };
            case 'heading': return { type: 'heading', level: node.level, children: inlines(node.children) };
            case 'list': return { type: 'list', ordered: node.ordered, ...(node.start !== undefined ? { start: node.start } : {}), items: node.items.map(item => ({ blocks: blocks(item.blocks) })) };
            case 'quote': return { type: 'quote', blocks: blocks(node.blocks) };
            case 'code': return { type: 'code', code: node.code, ...(node.language !== undefined ? { language: node.language } : {}), ...(node.meta !== undefined ? { meta: node.meta } : {}) };
            case 'math': return { type: 'math', source: node.source };
            case 'table': return table(node);
            case 'image': {
                const transportCaption = node.caption?.length === 1 && node.caption[0].type === 'text' && isTransportAlias(node.assetId, node.caption[0].text);
                const fallback = assetPresentation(assets.get(node.assetId), node.alt).caption;
                const caption = node.caption?.length && !transportCaption ? inlines(node.caption) : fallback ? [{ type: 'text' as const, text: fallback }] : undefined;
                const alt = label(node.assetId, !transportCaption ? node.alt ?? assetCaptionText(node.caption) : node.alt);
                return { type: 'image', resourceId: node.assetId, alt, ...(caption ? { caption } : {}) };
            }
            case 'file': {
                const asset = assets.get(node.assetId)!, name = label(node.assetId, node.label, 'Attachment');
                const description = node.description ? inlines(node.description) : undefined;
                return { type: 'file', resourceId: node.assetId, label: name, kind: asset.kind, ...(asset.mediaType ? { mediaType: asset.mediaType } : {}), ...(asset.byteLength !== undefined ? { byteLength: asset.byteLength } : {}), ...(description ? { description } : {}) };
            }
            case 'thematicBreak': return { type: 'thematicBreak' };
            case 'unknown': return { type: 'unsupported', sourceType: node.sourceType, text: node.text };
        }
    });
    return blocks;
}
