import {
    Document, ExternalHyperlink, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun,
    type FileChild, type ParagraphChild,
} from 'docx';
import type { DisplayBlock, DisplayInline, DocumentAst } from '../../../l3b/ast/ast.js';
import type { ResourceBindings } from '../../packaging/resourceBindings.js';
import type { PreparedResources } from '../../../shared/resources/resourceResult.js';
import type { RendererOptions } from '../shared/renderOptions.js';
import { headerMetadata, messageLabel, sourceLabel, unavailableResourceText } from '../shared/backendPresentation.js';
import { getRendererStrings } from '../shared/renderStrings.js';
import { safeExternalHref } from '../shared/safeLinks.js';
import { docxImageType, type DocxImageType } from '../../shared/docxImageType.js';

interface InlineStyle { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean; link?: boolean }

function textRun(text: string, style: InlineStyle = {}): TextRun {
    return new TextRun({
        text, bold: style.bold, italics: style.italics, strike: style.strike,
        ...(style.code ? { font: 'Consolas', size: 19 } : {}),
        ...(style.link ? { color: '2563EB', underline: {} } : {}),
    });
}

function imageDimensions(bytes: Uint8Array, format: DocxImageType): { width: number; height: number } {
    if (format === 'png') {
        const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return { width: data.getUint32(16), height: data.getUint32(20) };
    }
    if (format === 'gif') {
        return { width: bytes[6] + bytes[7] * 256, height: bytes[8] + bytes[9] * 256 };
    }
    // JPEG dimensions are not in a fixed header; keep a bounded preview aspect ratio.
    return { width: 640, height: 420 };
}

/** Pure format projection from trusted Document AST + prepared L4 bytes; no source reinterpretation. */
export async function renderDocumentDocx(
    document: DocumentAst,
    resources: ResourceBindings,
    prepared: PreparedResources,
    options: RendererOptions = {},
): Promise<Uint8Array> {
    const locale = options.locale ?? 'en';
    const strings = getRendererStrings(locale);
    const image = (resourceId: string, alt: string): ParagraphChild => {
        const resource = prepared.get(resourceId);
        const path = resources[resourceId];
        if (!resource?.ok || !path) {
            return textRun(unavailableResourceText('image', alt || resourceId, locale, options.resourceFailures?.[resourceId]));
        }
        const type = docxImageType(resource.value.mediaType, resource.value.bytes);
        if (!type) {
            return textRun((locale === 'zh' ? '图片附件：' : 'Image attachment: ') + (alt || resourceId) + ' (' + path + ')');
        }
        const dimensions = imageDimensions(resource.value.bytes, type);
        const width = Math.max(1, dimensions.width);
        const height = Math.max(1, dimensions.height);
        const scale = Math.min(1, 520 / width, 610 / height);
        return new ImageRun({
            type, data: resource.value.bytes,
            transformation: { width: Math.round(width * scale), height: Math.round(height * scale) },
            altText: { name: alt || 'Image', title: alt || 'Image', description: alt || 'Image' },
        });
    };
    const hyperlink = (href: string, children: ParagraphChild[]): ParagraphChild[] => {
        const url = safeExternalHref(href);
        return url ? [new ExternalHyperlink({ link: url, children })] : children;
    };
    const inlines = (nodes: readonly DisplayInline[], style: InlineStyle = {}): ParagraphChild[] =>
        nodes.flatMap((node): ParagraphChild[] => {
            switch (node.type) {
                case 'text': return [textRun(node.text, style)];
                case 'strong': return inlines(node.children, { ...style, bold: true });
                case 'emphasis': return inlines(node.children, { ...style, italics: true });
                case 'strikethrough': return inlines(node.children, { ...style, strike: true });
                case 'inlineCode': return [textRun(node.code, { ...style, code: true })];
                case 'inlineMath': return [textRun(node.source, { ...style, code: true })];
                case 'citation': return node.href
                    ? hyperlink(node.href, [textRun(node.label, { ...style, link: true })])
                    : [textRun(node.label, style)];
                case 'link': {
                    const url = safeExternalHref(node.href);
                    const children = inlines(node.children, url ? { ...style, link: true } : style);
                    return url ? [new ExternalHyperlink({ link: url, children })] : children;
                }
                case 'image': return [image(node.resourceId, node.alt)];
                case 'lineBreak': return [new TextRun({ text: '', break: 1 })];
            }
        });
    const p = (children: ParagraphChild[], style?: string): Paragraph =>
        new Paragraph({ children, ...(style ? { style } : {}) });
    const table = (node: Extract<DisplayBlock, { type: 'table' }>): FileChild[] => {
        const rows = [...node.headerRows, ...node.rows];
        if (!rows.length) return [p([textRun('')])];
        return [
            ...(node.caption ? [p(inlines(node.caption), 'Caption')] : []),
            new Table({
                rows: rows.map((cells, index) => new TableRow({
                    tableHeader: index < node.headerRows.length,
                    children: cells.map(cell => new TableCell({
                        children: [p(inlines(cell.children, index < node.headerRows.length ? { bold: true } : {}))],
                        ...(cell.colSpan > 1 ? { columnSpan: cell.colSpan } : {}),
                        ...(cell.rowSpan > 1 ? { rowSpan: cell.rowSpan } : {}),
                    })),
                })),
            }),
        ];
    };
    const blocks = (nodes: readonly DisplayBlock[], depth = 0, quote = false): FileChild[] =>
        nodes.flatMap(node => {
            switch (node.type) {
                case 'paragraph': return [p(inlines(node.children), quote ? 'Quote' : undefined)];
                case 'heading': {
                    const heading = [
                        HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
                        HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
                    ][node.level - 1];
                    return [new Paragraph({ children: inlines(node.children), heading })];
                }
                case 'list': return node.items.flatMap((item, index) => {
                    const prefix = node.ordered ? String((node.start ?? 1) + index) + '. ' : '• ';
                    const first = item.blocks[0];
                    if (first?.type === 'paragraph') {
                        return [new Paragraph({
                            children: [textRun(prefix), ...inlines(first.children)],
                            indent: { left: 540 + depth * 360, hanging: 300 },
                        }), ...blocks(item.blocks.slice(1), depth + 1, quote)];
                    }
                    return [new Paragraph({ text: prefix, indent: { left: 540 + depth * 360, hanging: 300 } }),
                        ...blocks(item.blocks, depth + 1, quote)];
                });
                case 'quote': return blocks(node.blocks, depth, true);
                case 'code': return node.code.replace(/\r\n?/g, '\n').split('\n')
                    .map(line => new Paragraph({
                        children: [textRun(line, { code: true })],
                        shading: { fill: 'F3F6FA' }, spacing: { after: 0 },
                        indent: { left: 200 },
                    }));
                case 'math': return [
                    p([textRun(strings.mathFallback, { italics: true })], 'Caption'),
                    p([textRun(node.source, { code: true })]),
                ];
                case 'table': return table(node);
                case 'image': return [
                    p([image(node.resourceId, node.alt)]),
                    ...(node.caption ? [p(inlines(node.caption), 'Caption')] : []),
                ];
                case 'file': return [
                    p([textRun((locale === 'zh' ? '附件：' : 'Attachment: ') + node.label
                        + (resources[node.resourceId] ? ' (' + resources[node.resourceId] + ')' : ''))]),
                    ...(node.description ? [p(inlines(node.description), 'Caption')] : []),
                ];
                case 'disclosure': return [
                    new Paragraph({ text: node.title, heading: HeadingLevel.HEADING_3 }),
                    ...blocks(node.blocks, depth, quote),
                ];
                case 'thematicBreak': return [p([textRun('________________________________________')], 'Caption')];
                case 'unsupported': return [
                    p([textRun(strings.unsupportedContent + ' · ' + node.sourceType, { bold: true })]),
                    p([textRun(node.text)]),
                ];
            }
        });
    const children: FileChild[] = [
        new Paragraph({ text: document.title, style: 'Title' }),
        new Paragraph({ text: headerMetadata(document, locale), style: 'Subtitle' }),
        ...document.messages.flatMap(message => [
            new Paragraph({ text: messageLabel(message, locale), heading: HeadingLevel.HEADING_2 }),
            ...(message.modelLabel ? [p([textRun(message.modelLabel, { italics: true })], 'Caption')] : []),
            ...blocks(message.blocks),
            ...(message.sources?.length ? [
                p([textRun(strings.sources + ':', { bold: true })], 'Caption'),
                ...message.sources.map(source => p(source.href
                    ? hyperlink(source.href, [textRun(sourceLabel(source), { link: true })])
                    : [textRun(sourceLabel(source))], 'Caption')),
            ] : []),
        ]),
        ...(!document.messages.length ? [p([textRun(strings.emptyConversation)])] : []),
    ];
    const word = new Document({ sections: [{ children }] });
    return new Uint8Array(await (await Packer.toBlob(word)).arrayBuffer());
}
