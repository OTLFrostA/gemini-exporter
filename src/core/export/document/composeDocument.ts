import type { BlockNode, TableBlock } from '../../content/blocks.js';
import type { InlineNode } from '../../content/inline.js';
import type { CanonicalConversationBundle } from '../canonical/conversation.js';
import { assetPresentation, assetCaptionText, isHumanMeaningfulFilename } from '../canonical/assetPresentation.js';
import { citationDisplayLabel } from '../canonical/citations.js';
import type { DisplayBlock, DisplayCell, DisplayInline, DocumentAst, DocumentDiagnostic } from './ast.js';

export interface CompositionOptions { documentLanguage?: string }

/** Compose facts and logical presentation. No output format, units, UI locale or resource paths. */
export function composeDocument(bundle: CanonicalConversationBundle, options: CompositionOptions = {}): { document: DocumentAst; diagnostics: DocumentDiagnostic[] } {
    const assets = new Map(bundle.assets.map(asset => [asset.id, asset]));
    const citations = new Map(bundle.citations.map((citation, index) => [citation.id, { ...citation, number: index + 1 }]));
    const diagnostics: DocumentDiagnostic[] = [];
    const source = (id: string, explicit?: string) => {
        const citation = citations.get(id);
        return { id, label: citation ? citationDisplayLabel(citation, citation.number, explicit) : explicit ?? id, ...(citation?.url ? { href: citation.url } : {}) };
    };
    const isTransportAlias = (id: string, value: string | undefined) => value !== undefined && value === assets.get(id)?.name && !isHumanMeaningfulFilename(value);
    const label = (id: string, explicit?: string, fallback = 'Image'): string => (!isTransportAlias(id, explicit) && explicit?.trim()) || assetPresentation(assets.get(id), undefined, fallback).label;
    const inlines = (nodes: InlineNode[]): DisplayInline[] => nodes.map(node => {
        switch (node.type) {
            case 'text': return { type: 'text', text: node.text };
            case 'strong': case 'emphasis': case 'strikethrough': return { type: node.type, children: inlines(node.children) };
            case 'inlineCode': return { type: 'inlineCode', code: node.code };
            case 'link': return { type: 'link', href: node.href, ...(node.title !== undefined ? { title: node.title } : {}), children: inlines(node.children) };
            case 'inlineMath': return { type: 'inlineMath', source: node.source };
            case 'lineBreak': return { type: 'lineBreak', kind: node.kind };
            case 'citationRef': return { type: 'citation', ...source(node.citationId, node.label) };
            case 'image': return assets.has(node.assetId) ? { type: 'image', resourceId: node.assetId, alt: node.alt ?? '', ...(node.title ? { title: node.title } : {}) } : { type: 'placeholder', resourceId: node.assetId, kind: 'image', text: node.alt ?? `[image: ${node.assetId}]` };
        }
    });
    const table = (node: TableBlock): DisplayBlock => {
        const occupied: number[] = [];
        const rows = [...(node.headerRows ?? []), ...node.rows].map((row, rowIndex) => {
            let column = 0;
            return row.cells.map(cell => {
                const colSpan = Math.max(1, cell.colSpan ?? 1), rowSpan = Math.max(1, cell.rowSpan ?? 1);
                while (Array.from({ length: colSpan }, (_, i) => occupied[column + i] > rowIndex).some(Boolean)) column++;
                const result: DisplayCell = { column, colSpan, rowSpan, align: node.columns?.[column]?.align ?? 'default', children: inlines(cell.children) };
                for (let i = 0; i < colSpan; i++) occupied[column + i] = rowIndex + rowSpan;
                column += colSpan; return result;
            });
        });
        const width = Math.max(1, node.columns?.length ?? 0, ...rows.flatMap(cells => cells.map(cell => cell.column + cell.colSpan)));
        return { type: 'table', columnAlignments: Array.from({ length: width }, (_, column) => node.columns?.[column]?.align ?? 'default'), ...(node.caption ? { caption: inlines(node.caption) } : {}), headerRows: rows.slice(0, node.headerRows?.length ?? 0), rows: rows.slice(node.headerRows?.length ?? 0) };
    };
    const blocks = (nodes: BlockNode[]): DisplayBlock[] => nodes.map(node => {
        switch (node.type) {
            case 'paragraph': return { type: 'paragraph', children: inlines(node.children) };
            case 'heading': return { type: 'heading', level: node.level, children: inlines(node.children) };
            case 'list': return { type: 'list', ordered: node.ordered, ...(node.start !== undefined ? { start: node.start } : {}), items: node.items.map(item => ({ blocks: blocks(item.blocks) })) };
            case 'quote': return { type: 'quote', blocks: blocks(node.blocks) };
            case 'code': return { type: 'code', code: node.code, showHeader: true, ...(node.language !== undefined ? { language: node.language } : {}), ...(node.filename !== undefined ? { filename: node.filename } : {}), ...(node.meta !== undefined ? { meta: node.meta } : {}) };
            case 'math': return { type: 'math', source: node.source };
            case 'table': return table(node);
            case 'image': {
                const transportCaption = node.caption?.length === 1 && node.caption[0].type === 'text' && isTransportAlias(node.assetId, node.caption[0].text);
                const fallback = assetPresentation(assets.get(node.assetId), node.alt).caption;
                const caption = node.caption?.length && !transportCaption ? inlines(node.caption) : fallback ? [{ type: 'text' as const, text: fallback }] : undefined;
                const alt = label(node.assetId, !transportCaption ? node.alt ?? assetCaptionText(node.caption) : node.alt);
                return assets.has(node.assetId) ? { type: 'image', resourceId: node.assetId, alt, ...(caption ? { caption } : {}) } : { type: 'placeholder', resourceId: node.assetId, kind: 'image', text: alt, ...(caption ? { details: caption } : {}) };
            }
            case 'file': {
                const asset = assets.get(node.assetId), name = label(node.assetId, node.label, 'Attachment');
                const description = node.description ? inlines(node.description) : undefined;
                return asset ? { type: 'file', resourceId: node.assetId, label: name, kind: asset.kind, ...(asset.mimeType ? { mediaType: asset.mimeType } : {}), ...(asset.sizeBytes !== undefined ? { byteLength: asset.sizeBytes } : {}), ...(description ? { description } : {}) } : { type: 'placeholder', resourceId: node.assetId, kind: 'file', text: name, ...(description ? { details: description } : {}) };
            }
            case 'thought': return { type: 'disclosure', kind: node.kind ?? 'unknown', blocks: blocks(node.blocks) };
            case 'thematicBreak': return { type: 'thematicBreak' };
            case 'unknown': return { type: 'unsupported', sourceType: node.sourceType, text: node.text };
        }
    });
    const messages = bundle.conversation.messages.map((message, index) => ({
        type: 'message' as const,
        id: message.id,
        anchor: `turn-${message.role === 'user' ? 'user' : 'model'}-${index}`,
        variant: message.role === 'user' ? 'bubble' as const : 'flow' as const,
        label: message.role === 'user' ? 'you' as const : message.role,
        ...(message.author?.model && message.role !== 'user' ? { modelLabel: message.author.model } : {}),
        ...(message.role === 'unknown' && message.author?.rawRole ? { heading: { level: 2 as const, text: message.author.rawRole } } : {}),
        blocks: blocks(message.blocks),
        ...(message.citationIds?.length ? { sources: { type: 'sources' as const, items: message.citationIds.map((id, index) => ({ ...source(id), number: index + 1 })) } } : {}),
    }));
    const conversation = bundle.conversation;
    return { document: {
        schemaVersion: 2,
        ...(options.documentLanguage ? { documentLanguage: options.documentLanguage } : {}),
        header: {
            title: (conversation.title || 'Untitled conversation').replace(/[\r\n]+/g, ' ').trim(),
            providerLabel: conversation.key.providerId,
             ...(conversation.updatedAt ?? conversation.createdAt ? { date: (conversation.updatedAt ?? conversation.createdAt)!.slice(0, 10) } : {}), messageCount: messages.length,
        },
        messages,
    }, diagnostics };
}

export function isArchiveResourceRef(ref: string): boolean { return Boolean(ref) && !/(^\/|\\|^[a-z][a-z\d+.-]*:|(^|\/)\.\.(\/|$))/i.test(ref); }
