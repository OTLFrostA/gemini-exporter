import type { DisplayBlock, DisplayInline, DocumentAst, ResourceBindings } from './ast.js';
import type { TypstBlockNode, TypstConversationRenderPayload, TypstInlineNode, TypstTableCell } from '../typst/transport.js';

/** Lower the display contract to the output engine's wire syntax. */
export function renderDocumentTypst(
    document: DocumentAst,
    resources: ResourceBindings,
    convertMath?: (source: string, display: boolean) => string | undefined,
): TypstConversationRenderPayload {
    if (document.profile.id !== 'pdf' || !document.pdfLayout) throw new TypeError('Expected a composed PDF profile');
    const resource = (id: string): string => {
        const path = resources[id];
        if (!path) throw new TypeError(`Missing prepared resource binding: ${id}`);
        return path;
    };
    const inline = (node: DisplayInline): TypstInlineNode => {
        switch (node.type) {
            case 'text': case 'placeholder': return { type: 'text', text: node.text };
            case 'strong': case 'emphasis': case 'strikethrough': return { type: node.type, children: node.children.map(inline) };
            case 'inlineCode': return { type: 'inlineCode', text: node.code };
            case 'link': return { type: 'link', url: node.href, children: node.children.map(inline) };
            case 'citation': return node.href ? { type: 'link', url: node.href, children: [{ type: 'text', text: node.label }] } : { type: 'text', text: node.label };
            case 'image': return { type: 'image', asset: resource(node.resourceId), ...(node.alt ? { alt: node.alt } : {}) };
            case 'lineBreak': return { type: 'lineBreak' };
            case 'inlineMath': {
                const typst = convertMath?.(node.source, false);
                return { type: 'inlineMath', latex: node.source, ...(typst ? { typst } : {}) };
            }
        }
    };
    // The PDF profile explicitly projects captions/descriptions to plain text.
    const text = (nodes: DisplayInline[]): string => nodes.map(node => {
        if (node.type !== 'text') throw new TypeError('PDF caption/description must be projected to text before encoding');
        return node.text;
    }).join('');
    const block = (node: DisplayBlock): TypstBlockNode => {
        if (!node.layout) throw new TypeError('PDF block requires composed layout policy');
        const layout = { ...node.layout };
        switch (node.type) {
            case 'paragraph': return { type: 'paragraph', children: node.children.map(inline), layout };
            case 'heading': return { type: 'heading', level: node.level, children: node.children.map(inline), layout };
            case 'list': return { type: 'list', ordered: node.ordered, ...(node.start !== undefined ? { start: node.start } : {}), items: node.items.map(item => ({ blocks: item.blocks.map(block) })), layout };
            case 'quote': return { type: 'quote', blocks: node.blocks.map(block), layout };
            case 'code': return { type: 'code', language: node.language, header: node.header, text: node.code, layout };
            case 'math': {
                const typst = convertMath?.(node.source, true);
                return { type: 'math', latex: node.source, ...(typst ? { typst } : {}), fallbackLabel: document.mathFallbackLabel, layout };
            }
            case 'table': {
                const cell = (entry: typeof node.rows[number][number]): TypstTableCell => ({ children: entry.children.map(inline), ...(entry.colSpan > 1 ? { colspan: entry.colSpan } : {}), ...(entry.rowSpan > 1 ? { rowspan: entry.rowSpan } : {}) });
                if (node.repeatHeader === undefined) throw new TypeError('PDF table requires explicit header repetition policy');
                return { type: 'table', headers: node.headerRows.map(row => row.map(cell)), rows: node.rows.map(row => row.map(cell)), columnCount: node.columnAlignments.length, aligns: node.columnAlignments.map(align => align === 'default' ? 'left' : align), repeatHeader: node.repeatHeader, ...(node.caption?.length ? { caption: text(node.caption) } : {}), layout };
            }
            case 'image': return { type: 'image', asset: resource(node.resourceId), ...(node.caption?.length ? { caption: text(node.caption) } : {}), layout };
            case 'file': {
                if (node.size === undefined || node.metadata === undefined) throw new TypeError('PDF file requires composed display metadata');
                return { type: 'file', name: node.label, kind: node.badge, size: node.size, metadata: node.metadata, ...(node.description?.length ? { description: text(node.description) } : {}), layout };
            }
            case 'note': return { type: 'note', ...(node.title !== undefined ? { label: node.title } : {}), ...(node.children ? { children: node.children.map(inline) } : {}), ...(node.blocks ? { blocks: node.blocks.map(block) } : {}), layout };
            case 'unsupported': return { type: 'unknown', sourceType: node.sourceType, label: node.label, fallback: node.text, layout };
            case 'thematicBreak': return { type: 'thematicBreak', layout };
            case 'disclosure': case 'placeholder': throw new TypeError(`Unprojected PDF component: ${node.type}`);
        }
    };
    return {
        schemaVersion: 1, profile: { id: 'pdf', version: 1 }, title: document.header.title, metadata: document.header.metadata,
        layout: structuredClone(document.pdfLayout),
        messages: document.messages.map(message => {
            if (!message.minWidthCards || message.gapAfterPt === undefined) throw new TypeError('PDF message requires composed layout policy');
            return { id: message.id, variant: message.variant, ...(message.modelLabel ? { model: message.modelLabel } : {}), ...(message.measurementText ? { plainText: message.measurementText } : {}), minWidthCards: message.minWidthCards.map(card => ({ ...card })), gapAfterPt: message.gapAfterPt, blocks: message.blocks.map(block) };
        }),
    };
}
