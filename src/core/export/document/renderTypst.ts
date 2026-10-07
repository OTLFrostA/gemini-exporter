import type { DisplayBlock, DisplayInline, DocumentAst, ResourceBindings } from './ast.js';
import { visual } from '../visualContract.js';
import { blockText, inlineText, codeHeader, fileBadge, humanBytes, disclosureTitle, headerMetadata } from './backendPresentation.js';
import { getRendererStrings } from './renderStrings.js';
import type { PdfRenderOptions } from './renderOptions.js';
import { defaultPdfLayout, applyLayout } from '../typst/layout.js';
export { defaultPdfLayout } from '../typst/layout.js';
import type { TypstBlockNode, TypstConversationRenderPayload, TypstInlineNode, TypstTableCell } from '../typst/transport.js';

/** Lower the display contract to the output engine's wire syntax. */
export function renderDocumentTypst(
    document: DocumentAst,
    resources: ResourceBindings,
    options: PdfRenderOptions = {},
): TypstConversationRenderPayload {
    const locale = options.locale ?? 'en';
    const strings = getRendererStrings(locale);
    const resource = (id: string): string => {
        const path = resources[id];
        if (!path) throw new TypeError(`Missing prepared resource binding: ${id}`);
        return path;
    };
    const inline = (node: DisplayInline): TypstInlineNode => {
        switch (node.type) {
            case 'text': return { type: 'text', text: node.text };
            case 'placeholder':
                options.onDiagnostic?.({ severity: 'warning', code: 'TYPST_V8_INLINE_IMAGE_MISSING', message: `Missing inline resource ${node.text}` });
                return { type: 'text', text: node.text };
            case 'strong': case 'emphasis': case 'strikethrough': return { type: node.type, children: node.children.map(inline) };
            case 'inlineCode': return { type: 'inlineCode', text: node.code };
            case 'link': return { type: 'link', url: node.href, children: node.children.map(inline) };
            case 'citation': return node.href ? { type: 'link', url: node.href, children: [{ type: 'text', text: node.label }] } : { type: 'text', text: node.label };
            case 'image':
                if (!resources[node.resourceId]) options.onDiagnostic?.({ severity: 'warning', code: 'TYPST_V8_INLINE_IMAGE_MISSING', message: `Missing prepared image ${node.resourceId}` });
                return resources[node.resourceId] ? { type: 'image', asset: resource(node.resourceId), ...(node.alt ? { alt: node.alt } : {}) } : { type: 'text', text: node.alt || node.resourceId };
            case 'lineBreak': return { type: 'lineBreak' };
            case 'inlineMath': {
                const typst = options.convertMath?.(node.source, false);
                return { type: 'inlineMath', latex: node.source, ...(typst ? { typst } : {}) };
            }
        }
    };
    // Capability degradation is local to the PDF backend and never changes the tree.
    const text = (nodes: DisplayInline[]): string => nodes.map(inlineText).join('');
    const missing = (kind: string, label: string, details?: DisplayInline[]): TypstBlockNode => {
        options.onDiagnostic?.({ severity: 'warning', code: 'TYPST_V8_IMAGE_MISSING', message: `Missing prepared ${kind} resource` });
        return ({ type: 'unknown', sourceType: `missing-${kind}`, label: `${strings.unsupportedContent} · missing-${kind}`, fallback: [label, details && text(details)].filter(Boolean).join('\n\n'), layout: { gapBeforePt: 0, keepWithNext: false, width: 'reading' } });
    };
    const block = (node: DisplayBlock): TypstBlockNode => {
        const layout = { gapBeforePt: 0, keepWithNext: false, width: 'full' as const };
        switch (node.type) {
            case 'paragraph': return { type: 'paragraph', children: node.children.map(inline), layout };
            case 'heading': return { type: 'heading', level: node.level, children: node.children.map(inline), layout };
            case 'list': return { type: 'list', ordered: node.ordered, ...(node.start !== undefined ? { start: node.start } : {}), items: node.items.map(item => ({ blocks: item.blocks.map(block) })), layout };
            case 'quote': return { type: 'quote', blocks: node.blocks.map(block), layout };
            case 'code': return { type: 'code', language: node.language ?? 'text', header: codeHeader(node, 'pdf'), text: node.code, layout };
            case 'math': {
                const typst = options.convertMath?.(node.source, true);
                return { type: 'math', latex: node.source, ...(typst ? { typst } : {}), fallbackLabel: strings.mathFallback, layout };
            }
            case 'table': {
                const cell = (entry: typeof node.rows[number][number]): TypstTableCell => ({ children: entry.children.map(inline), ...(entry.colSpan > 1 ? { colspan: entry.colSpan } : {}), ...(entry.rowSpan > 1 ? { rowspan: entry.rowSpan } : {}) });
                return { type: 'table', headers: node.headerRows.map(row => row.map(cell)), rows: node.rows.map(row => row.map(cell)), columnCount: node.columnAlignments.length, aligns: node.columnAlignments.map(align => align === 'default' ? 'left' : align), repeatHeader: options.repeatTableHeader ?? true, ...(node.caption?.length ? { caption: text(node.caption) } : {}), layout };
            }
            case 'image': return resources[node.resourceId] ? { type: 'image', asset: resource(node.resourceId), ...(node.caption?.length ? { caption: text(node.caption) } : {}), layout } : missing('image', node.caption?.length ? text(node.caption) : node.alt);
            case 'file': {
                const kind = fileBadge(node), size = humanBytes(node.byteLength, strings.sizeUnknown);
                return { type: 'file', name: node.label, kind, size, metadata: `${kind} · ${size}`, ...(node.description?.length ? { description: text(node.description) } : {}), layout };
            }
            case 'unsupported': return { type: 'unknown', sourceType: node.sourceType, label: `${strings.unsupportedContent} · ${node.sourceType}`, fallback: node.text, layout };
            case 'thematicBreak': return { type: 'thematicBreak', layout };
            case 'disclosure': return { type: 'note', ...(['summary', 'progress', 'reasoning'].includes(node.kind) || node.title ? { label: disclosureTitle(node, options) } : {}), blocks: node.blocks.map(block), layout };
            case 'placeholder': return missing(node.kind, node.text, node.details);
        }
    };
    return {
        schemaVersion: 1, profile: { id: 'pdf', version: 1 }, title: document.header.title, metadata: headerMetadata(document, locale, true),
        layout: structuredClone(options.layout ?? defaultPdfLayout(document.documentLanguage)),
        messages: document.messages.map((message, index) => {
            const blocks = message.blocks.map(block);
            const prefix = message.label === 'system' ? strings.systemMessage : message.label === 'developer' ? strings.developerMessage : message.label === 'unknown' ? strings.unknownRole + (message.heading?.text ? `: ${message.heading.text}` : '') : undefined;
            if (prefix) blocks.unshift({ type: 'note', children: [{ type: 'text', text: prefix }], layout: { gapBeforePt: 0, keepWithNext: false, width: 'reading' } });
            if (message.sources?.items.length) blocks.push({ type: 'note', children: [{ type: 'text', text: message.sources.items.map(item => item.label).join(' · ') }], layout: { gapBeforePt: 0, keepWithNext: false, width: 'reading' } });
            applyLayout(blocks, message.variant === 'bubble', false);
            const next = document.messages[index + 1];
            return { id: message.id, variant: message.variant, plainText: message.blocks.map(blockText).join('\n'), minWidthCards: blocks.flatMap(node => node.type === 'file' ? [{ label: node.name, metadata: node.metadata }] : []), gapAfterPt: next ? (message.variant === 'flow' && next.variant === 'bubble' ? visual.spacing.turn : visual.spacing.section) * 0.75 : 0, blocks };
        }),
    };
}
