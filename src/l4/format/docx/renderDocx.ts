import type { DocumentAst, DisplayBlock, DisplayCell, DisplayInline } from '../../../l3b/ast/ast.js';
import type { ResourceBindings } from '../../packaging/resourceBindings.js';
import type { PreparedResources } from '../../../shared/resources/resourceResult.js';
import type { RendererOptions } from '../shared/renderOptions.js';
import { headerMetadata, messageLabel, sourceLabel, unavailableResourceText } from '../shared/backendPresentation.js';
import { getRendererStrings } from '../shared/renderStrings.js';
import { safeExternalHref } from '../shared/safeLinks.js';
import { ZipWriter } from '../../packaging/writers/zipWriter.js';
import { docxImageType, type DocxImageType } from './imageType.js';

/** WordprocessingML is projected directly from the trusted Document AST. No HTML or Markdown round-trip. */
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DRAW = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const xml = (value: string): string => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/[&<>"']/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;');

interface RunStyle { bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; link?: boolean }
type ParagraphStyle = 'Normal' | 'Title' | 'Subtitle' | 'Role' | 'Heading1' | 'Heading2' | 'Heading3' | 'Quote' | 'Code' | 'List' | 'Caption';
interface EmbeddedImage { path: string; bytes: Uint8Array }

function textRun(value: string, style: RunStyle = {}): string {
    const properties = [
        style.bold ? '<w:b/>' : '',
        style.italic ? '<w:i/>' : '',
        style.strike ? '<w:strike/>' : '',
        style.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei"/><w:sz w:val="19"/>' : '',
        style.link ? '<w:color w:val="2563EB"/><w:u w:val="single"/>' : '',
    ].join('');
    const parts = value.replace(/\r\n?/g, '\n').split('\n').map((line, index) =>
        (index ? '<w:br/>' : '') + '<w:t xml:space="preserve">' + xml(line) + '</w:t>').join('');
    return '<w:r>' + (properties ? '<w:rPr>' + properties + '</w:rPr>' : '') + parts + '</w:r>';
}
function paragraph(content: string, style: ParagraphStyle = 'Normal', indent = 0): string {
    return '<w:p><w:pPr><w:pStyle w:val="' + style + '"/>'
        + (indent ? '<w:ind w:left="' + indent + '"/>' : '')
        + '</w:pPr>' + (content || textRun('')) + '</w:p>';
}
function imageDimensions(bytes: Uint8Array, format: DocxImageType): { width: number; height: number } {
    if (format === 'png') {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (format === 'gif') return { width: bytes[6] + bytes[7] * 256, height: bytes[8] + bytes[9] * 256 };
    // JPEG dimensions are not a fixed header field; use a legible preview-sized bounding box.
    return { width: 640, height: 420 };
}
const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:styles xmlns:w="' + W + '">'
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Microsoft YaHei"/>'
    + '<w:sz w:val="22"/><w:color w:val="202431"/></w:rPr></w:rPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>'
    + '<w:pPr><w:spacing w:after="140" w:line="300" w:lineRule="auto"/></w:pPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>'
    + '<w:pPr><w:spacing w:after="180"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="202A44"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/>'
    + '<w:pPr><w:spacing w:after="300"/></w:pPr><w:rPr><w:sz w:val="19"/><w:color w:val="64748B"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Role"><w:name w:val="Role"/>'
    + '<w:pPr><w:spacing w:before="260" w:after="100"/><w:keepNext/></w:pPr>'
    + '<w:rPr><w:b/><w:sz w:val="25"/><w:color w:val="3158A3"/></w:rPr></w:style>'
    + [1, 2, 3].map(level => '<w:style w:type="paragraph" w:styleId="Heading' + level + '"><w:name w:val="Heading ' + level + '"/>'
        + '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="100"/><w:keepNext/></w:pPr>'
        + '<w:rPr><w:b/><w:sz w:val="' + (30 - level * 3) + '"/><w:color w:val="283F6A"/></w:rPr></w:style>').join('')
    + '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/>'
    + '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="480"/><w:pBdr><w:left w:val="single" w:sz="16" w:color="A8B6D2" w:space="8"/></w:pBdr></w:pPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/>'
    + '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/><w:ind w:left="220"/><w:shd w:fill="F3F6FA"/></w:pPr>'
    + '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="List"><w:name w:val="List"/>'
    + '<w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="500" w:hanging="300"/></w:pPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/>'
    + '<w:basedOn w:val="Normal"/><w:rPr><w:i/><w:sz w:val="18"/><w:color w:val="64748B"/></w:rPr></w:style>'
    + '</w:styles>';

export async function renderDocumentDocx(
    document: DocumentAst,
    resources: ResourceBindings,
    prepared: PreparedResources,
    options: RendererOptions = {},
): Promise<Uint8Array> {
    const locale = options.locale ?? 'en';
    const strings = getRendererStrings(locale);
    const relationships: string[] = [
        '<Relationship Id="rId1" Type="' + REL + '/styles" Target="styles.xml"/>',
    ];
    const images: EmbeddedImage[] = [];
    let nextRelationship = 2;
    const link = (href: string, content: string): string => {
        const safe = safeExternalHref(href);
        if (!safe) return content;
        const id = 'rId' + nextRelationship++;
        relationships.push('<Relationship Id="' + id + '" Type="' + REL + '/hyperlink" Target="' + xml(safe) + '" TargetMode="External"/>');
        return '<w:hyperlink r:id="' + id + '">' + content + '</w:hyperlink>';
    };
    const image = (resourceId: string, alt: string): string => {
        const resource = prepared.get(resourceId);
        const binding = resources[resourceId];
        if (!resource?.ok || !binding) {
            return textRun(unavailableResourceText('image', alt || resourceId, locale, options.resourceFailures?.[resourceId]));
        }
        const format = docxImageType(resource.value.mediaType, resource.value.bytes);
        if (!format) return textRun((locale === 'zh' ? '图片附件：' : 'Image attachment: ') + (alt || resourceId) + ' (' + binding + ')');
        const id = 'rId' + nextRelationship++;
        const path = 'word/media/image-' + (images.length + 1) + '.' + format;
        images.push({ path, bytes: resource.value.bytes });
        relationships.push('<Relationship Id="' + id + '" Type="' + REL + '/image" Target="media/' + path.slice('word/media/'.length) + '"/>');
        const size = imageDimensions(resource.value.bytes, format);
        const w = Math.max(1, size.width);
        const h = Math.max(1, size.height);
        const scale = Math.min(1, 520 / w, 610 / h);
        const cx = Math.round(w * scale * 9525);
        const cy = Math.round(h * scale * 9525);
        const name = xml(alt || 'Image');
        const index = images.length;
        return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
            + '<wp:extent cx="' + cx + '" cy="' + cy + '"/>'
            + '<wp:docPr id="' + index + '" name="' + name + '" descr="' + name + '"/>'
            + '<a:graphic><a:graphicData uri="' + PIC + '"><pic:pic>'
            + '<pic:nvPicPr><pic:cNvPr id="0" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr>'
            + '<pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>'
            + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
            + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    };
    function inlines(nodes: readonly DisplayInline[], style: RunStyle = {}): string {
        return nodes.map(node => {
            switch (node.type) {
                case 'text': return textRun(node.text, style);
                case 'strong': return inlines(node.children, { ...style, bold: true });
                case 'emphasis': return inlines(node.children, { ...style, italic: true });
                case 'strikethrough': return inlines(node.children, { ...style, strike: true });
                case 'inlineCode': return textRun(node.code, { ...style, code: true });
                case 'inlineMath': return textRun(node.source, { ...style, code: true });
                case 'citation': return node.href ? link(node.href, textRun(node.label, { ...style, link: true })) : textRun(node.label, style);
                case 'link': {
                    const href = safeExternalHref(node.href);
                    return href ? link(href, inlines(node.children, { ...style, link: true })) : inlines(node.children, style);
                }
                case 'image': return image(node.resourceId, node.alt);
                case 'lineBreak': return '<w:r><w:br/></w:r>';
            }
        }).join('');
    }
    function table(node: Extract<DisplayBlock, { type: 'table' }>): string {
        const width = Math.max(1, node.columnAlignments.length);
        const twips = Math.floor(9360 / width);
        const active = new Map<number, { remaining: number; span: number }>();
        const tableRows = [...node.headerRows, ...node.rows];
        const cells = tableRows.map((row, rowIndex) => {
            const byColumn = new Map<number, DisplayCell>(row.map(cell => [cell.column, cell]));
            let xmlRow = '';
            for (let col = 0; col < width;) {
                const carry = active.get(col);
                const cell = byColumn.get(col);
                const span = Math.max(1, cell?.colSpan ?? carry?.span ?? 1);
                let merge = '';
                if (!cell && carry) {
                    merge = '<w:vMerge/>';
                    if (carry.remaining === 1) active.delete(col);
                    else active.set(col, { ...carry, remaining: carry.remaining - 1 });
                } else if (cell?.rowSpan && cell.rowSpan > 1) {
                    merge = '<w:vMerge w:val="restart"/>';
                    active.set(col, { remaining: cell.rowSpan - 1, span });
                }
                const heading = rowIndex < node.headerRows.length;
                xmlRow += '<w:tc><w:tcPr><w:tcW w:w="' + (span * twips) + '" w:type="dxa"/>'
                    + (span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : '') + merge
                    + (heading ? '<w:shd w:fill="EFF4FF"/>' : '') + '</w:tcPr>'
                    + paragraph(cell ? inlines(cell.children, heading ? { bold: true } : {}) : '') + '</w:tc>';
                col += span;
            }
            return '<w:tr>' + (rowIndex < node.headerRows.length ? '<w:trPr><w:tblHeader/></w:trPr>' : '') + xmlRow + '</w:tr>';
        }).join('');
        return (node.caption ? paragraph(inlines(node.caption), 'Caption') : '')
            + '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/>'
            + '<w:tblBorders><w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/>'
            + '<w:insideH w:val="single" w:sz="3" w:color="E2E8F0"/></w:tblBorders>'
            + '<w:tblCellMar><w:top w:w="95" w:type="dxa"/><w:bottom w:w="95" w:type="dxa"/>'
            + '<w:left w:w="125" w:type="dxa"/><w:right w:w="125" w:type="dxa"/></w:tblCellMar></w:tblPr>'
            + '<w:tblGrid>' + Array.from({ length: width }, () => '<w:gridCol w:w="' + twips + '"/>').join('') + '</w:tblGrid>'
            + cells + '</w:tbl>';
    }
    function renderTable(node: Extract<DisplayBlock, { type: 'table' }>): string {
        return table(node);
    }
    function blocks(nodes: readonly DisplayBlock[], depth = 0, quoted = false): string {
        return nodes.map(node => block(node, depth, quoted)).join('');
    }
    function block(node: DisplayBlock, depth = 0, quoted = false): string {
        switch (node.type) {
            case 'paragraph': return paragraph(inlines(node.children), quoted ? 'Quote' : 'Normal');
            case 'heading': return paragraph(inlines(node.children),
                node.level < 3 ? 'Heading1' : node.level < 5 ? 'Heading2' : 'Heading3');
            case 'list': return node.items.map((item, index) => {
                const prefix = node.ordered ? String((node.start ?? 1) + index) + '. ' : '• ';
                const first = item.blocks[0];
                if (first?.type === 'paragraph') return paragraph(textRun(prefix) + inlines(first.children), 'List', depth * 360)
                    + blocks(item.blocks.slice(1), depth + 1, quoted);
                return paragraph(textRun(prefix), 'List', depth * 360) + blocks(item.blocks, depth + 1, quoted);
            }).join('');
            case 'quote': return blocks(node.blocks, depth, true);
            case 'code': return (node.code.replace(/\r\n?/g, '\n').split('\n')).map(line => paragraph(textRun(line, { code: true }), 'Code')).join('');
            case 'math': return paragraph(textRun(strings.mathFallback, { italic: true }))
                + paragraph(textRun(node.source, { code: true }), 'Code');
            case 'table': return renderTable(node);
            case 'image': return paragraph(image(node.resourceId, node.alt))
                + (node.caption ? paragraph(inlines(node.caption), 'Caption') : '');
            case 'file': return paragraph(textRun((locale === 'zh' ? '附件：' : 'Attachment: ') + node.label
                + (resources[node.resourceId] ? ' (' + resources[node.resourceId] + ')' : '')))
                + (node.description ? paragraph(inlines(node.description), 'Caption') : '');
            case 'disclosure': return paragraph(textRun(node.title, { bold: true }), 'Heading3') + blocks(node.blocks, depth, quoted);
            case 'thematicBreak': return paragraph(textRun('________________________________________'), 'Caption');
            case 'unsupported': return paragraph(textRun(strings.unsupportedContent + ' · ' + node.sourceType, { bold: true }))
                + paragraph(textRun(node.text));
        }
    }
    const body = [
        paragraph(textRun(document.title), 'Title'),
        paragraph(textRun(headerMetadata(document, locale)), 'Subtitle'),
        ...document.messages.map(message =>
            paragraph(textRun(messageLabel(message, locale)), 'Role')
            + (message.modelLabel ? paragraph(textRun(message.modelLabel, { italic: true }), 'Caption') : '')
            + blocks(message.blocks)
            + (message.sources?.length ? paragraph(textRun(strings.sources + ':', { bold: true }), 'Caption')
                + message.sources.map(source => paragraph(source.href
                    ? link(source.href, textRun(sourceLabel(source), { link: true }))
                    : textRun(sourceLabel(source)), 'Caption')).join('') : '')),
        ...(!document.messages.length ? [paragraph(textRun(strings.emptyConversation))] : []),
    ].join('');
    const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<w:document xmlns:w="' + W + '" xmlns:r="' + REL + '" xmlns:a="' + DRAW
        + '" xmlns:wp="' + WP + '" xmlns:pic="' + PIC + '"><w:body>' + body
        + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
        + '<w:pgMar w:top="1150" w:right="1250" w:bottom="1150" w:left="1250" w:header="540" w:footer="540"/></w:sectPr>'
        + '</w:body></w:document>';
    const writer = new ZipWriter();
    writer.writeFile('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Default Extension="png" ContentType="image/png"/>'
        + '<Default Extension="jpeg" ContentType="image/jpeg"/>'
        + '<Default Extension="gif" ContentType="image/gif"/>'
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        + '</Types>');
    writer.writeFile('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="' + PACKAGE_REL + '">'
        + '<Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="word/document.xml"/>'
        + '</Relationships>');
    writer.writeFile('word/document.xml', documentXml);
    writer.writeFile('word/styles.xml', stylesXml);
    writer.writeFile('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="' + PACKAGE_REL + '">' + relationships.join('') + '</Relationships>');
    for (const item of images) writer.writeFile(item.path, item.bytes);
    return new Uint8Array(await (await writer.generateBlob()).arrayBuffer());
}
