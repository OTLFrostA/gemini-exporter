import type { BlockNode, TableBlock } from '../../content/blocks.js';
import type { InlineNode } from '../../content/inline.js';
import type { CanonicalConversationBundle } from '../canonical/conversation.js';
import { assetPresentation, assetCaptionText, isHumanMeaningfulFilename } from '../canonical/assetPresentation.js';
import { citationDisplayLabel } from '../canonical/citations.js';
import { getRendererStrings } from '../canonical/rendererStrings.js';
import type { Asset } from '../canonical/assets.js';
import { visual } from '../visualContract.js';
import { extractBlockText, extractInlineText } from '../canonical/unknownFallback.js';
import { sanitizeUrl } from '../../engine/template/htmlTemplate.js';
import type { DisplayBlock, DisplayCell, DisplayInline, DocumentAst, DocumentDiagnostic, ResourceBindings } from './ast.js';

export interface CompositionOptions {
    lang?: 'zh' | 'en';
    exportedAt?: string;
    theme?: 'dark' | 'light';
    thoughtInitiallyCollapsed?: boolean;
}

/** Selection happens here; renderer never sees a semantic Asset or Citation. */
export function composeDocument(
    bundle: CanonicalConversationBundle,
    bindings: ResourceBindings,
    profile: 'html' | 'markdown' | 'pdf',
    options: CompositionOptions = {},
): { document: DocumentAst; diagnostics: DocumentDiagnostic[] } {
    const isPdf = profile === 'pdf';
    const isMarkdown = profile === 'markdown';
    const isEn = options.lang === 'en' || ((isMarkdown || isPdf) && options.lang === undefined);
    const strings = getRendererStrings(isEn ? 'en' : 'zh');
    const assets = new Map(bundle.assets.map(a => [a.id, a]));
    const citations = new Map(bundle.citations.map((c, index) => [c.id, { ...c, number: index + 1 }]));
    const diagnostics: DocumentDiagnostic[] = [];
    const available = (id: string): boolean => {
        const ref = bindings[id];
        return Boolean(assets.has(id) && ref && (isPdf ? true : isMarkdown ? isArchiveResourceRef(ref) : sanitizeUrl(ref, true) !== '#'));
    };
    const source = (id: string, explicit?: string) => {
        const c = citations.get(id);
        const label = c ? citationDisplayLabel(c, c.number, explicit) : (explicit ?? (isPdf ? `[${id}]` : id));
        return { id, label, ...(c?.url ? { href: c.url } : {}) };
    };
    // Legacy normalizers can copy the transport filename into alt/caption.
    // Only that exact known alias is filtered; authored prose/numeric captions survive.
    const isTransportAlias = (id: string, value: string | undefined): boolean =>
        value !== undefined && value === assets.get(id)?.name && !isHumanMeaningfulFilename(value);
    const label = (id: string, explicit?: string, fallback = 'Image'): string =>
        (!isTransportAlias(id, explicit) && explicit?.trim()) || assetPresentation(assets.get(id), undefined, fallback).label;
    const missing = (id: string, path: string, inline = false): void => {
        diagnostics.push({ severity: 'warning', code: isPdf ? (inline ? 'TYPST_V8_INLINE_IMAGE_MISSING' : 'TYPST_V8_IMAGE_MISSING') : `${profile.toUpperCase()}_ASSET_UNRESOLVED`, message: `${inline ? 'inline image ' : ''}asset ${id} has no resolvable offline URL; rendered as a visible placeholder`, path });
    };
    const inlines = (nodes: InlineNode[], path: string): DisplayInline[] => nodes.map(node => {
        switch (node.type) {
            case 'text': return { type: 'text', text: node.text };
            case 'strong': case 'emphasis': case 'strikethrough':
                return { type: node.type, children: inlines(node.children, path) };
            case 'inlineCode': return { type: 'inlineCode', code: node.code };
            case 'link': return { type: 'link', href: node.href, ...(node.title !== undefined ? { title: node.title } : {}), children: inlines(node.children, path) };
            case 'inlineMath': return { type: 'inlineMath', source: node.source };
            case 'lineBreak': return { type: 'lineBreak', kind: node.kind };
            case 'citationRef': return { type: 'citation', ...source(node.citationId, node.label) };
            case 'image': {
                const alt = isPdf ? node.alt ?? '' : label(node.assetId, node.alt);
                if (!available(node.assetId)) {
                    missing(node.assetId, path, true);
                    return { type: 'placeholder', ...(isMarkdown ? { enclosure: 'brackets' as const } : {}), text: isPdf ? node.alt ?? assets.get(node.assetId)?.name ?? `[image: ${node.assetId}]` : isMarkdown ? `Image unavailable: ${alt}` : `${isEn ? 'Image missing' : '图片缺失'} · ${alt}` };
                }
                return { type: 'image', resourceId: node.assetId, alt, ...(node.title !== undefined ? { title: node.title } : {}) };
            }
        }
    });
    const table = (node: TableBlock, path: string): DisplayBlock => {
        // Track occupied logical columns across rows, including row spans.
        const occupied: number[] = [];
        const rows = [...(node.headerRows ?? []), ...node.rows].map((row, rowIndex) => {
            let column = 0;
            return row.cells.map(cell => {
                const colSpan = Math.max(1, cell.colSpan ?? 1);
                const rowSpan = Math.max(1, cell.rowSpan ?? 1);
                while (Array.from({ length: colSpan }, (_, i) => occupied[column + i] > rowIndex).some(Boolean)) column++;
                const result: DisplayCell = { column, colSpan, rowSpan, align: node.columns?.[column]?.align ?? 'default', children: inlines(cell.children, path) };
                for (let i = 0; i < colSpan; i++) occupied[column + i] = rowIndex + rowSpan;
                column += colSpan;
                return result;
            });
        });
        const headers = node.headerRows?.length ?? 0;
        const width = Math.max(1, node.columns?.length ?? 0, ...rows.flatMap(cells => cells.map(cell => cell.column + cell.colSpan)));
        const columnAlignments = Array.from({ length: width }, (_, column) => node.columns?.[column]?.align ?? 'default');
        if (isMarkdown) {
            // GFM has one header row and no spans. Project a complete rectangular
            // grid here; continued spans are empty and extra headers become body rows.
            const blank = (column: number): DisplayCell => ({ column, colSpan: 1, rowSpan: 1, align: columnAlignments[column], children: [] });
            const projected = rows.map(cells => {
                const result = Array.from({ length: width }, (_, column) => blank(column));
                for (const cell of cells) result[cell.column] = { ...cell, colSpan: 1, rowSpan: 1 };
                return result;
            });
            return { type: 'table', columnAlignments, ...(node.caption ? { caption: isPdf ? [{ type: 'text' as const, text: node.caption.map(n => extractInlineText(n, { citationLabel: id => source(id).label })).join('') }] : inlines(node.caption, path) } : {}), headerRows: [headers ? projected[0] : Array.from({ length: width }, (_, column) => blank(column))], rows: projected.slice(headers ? 1 : 0) };
        }
        return { type: 'table', columnAlignments, ...(node.caption ? { caption: isPdf ? [{ type: 'text' as const, text: node.caption.map(n => extractInlineText(n, { citationLabel: id => source(id).label })).join('') }] : inlines(node.caption, path) } : {}), ...(isPdf ? { repeatHeader: true } : {}), headerRows: rows.slice(0, headers), rows: rows.slice(headers) };
    };
    const blocks = (nodes: BlockNode[], path: string): DisplayBlock[] => nodes.map((node, i) => block(node, `${path}/block:${i}`));
    const block = (node: BlockNode, path: string): DisplayBlock => {
        switch (node.type) {
            case 'paragraph': return { type: 'paragraph', children: inlines(node.children, path) };
            case 'heading': return { type: 'heading', level: node.level, children: inlines(node.children, path) };
            case 'list': return { type: 'list', ordered: node.ordered, ...(node.start !== undefined ? { start: node.start } : {}), items: node.items.map((item, i) => ({ blocks: blocks(item.blocks, `${path}/item:${i}`) })) };
            case 'quote': return { type: 'quote', blocks: blocks(node.blocks, `${path}/quote`) };
            case 'code': {
                const language = isPdf ? node.language ?? 'text' : node.language || (isMarkdown ? '' : 'text');
                const header = isMarkdown ? [node.filename, node.meta].filter(Boolean).join(' · ') : node.filename ? (language !== 'text' ? `${node.filename} · ${language}` : node.filename) : language;
                return { type: 'code', language, header: isPdf ? header + (node.meta ? ` · ${node.meta}` : '') : header, code: node.code, ...(!isMarkdown && !isPdf && node.meta !== undefined ? { meta: node.meta } : {}), ...(!isMarkdown && !isPdf ? { copy: { label: isEn ? 'Copy' : '复制', title: 'Copy Code' } } : {}) };
            }
            case 'math': return { type: 'math', source: node.source };
            case 'table': return table(node, path);
            case 'image': {
                // Explicit captions are authored content, never opaque-filename candidates.
                const fallbackCaption = assetPresentation(assets.get(node.assetId), node.alt).caption;
                const transportCaption = node.caption?.length === 1 && node.caption[0].type === 'text' && isTransportAlias(node.assetId, node.caption[0].text);
                let caption = node.caption?.length && !transportCaption ? inlines(node.caption, path) : fallbackCaption ? [{ type: 'text' as const, text: fallbackCaption }] : undefined;
                if (isPdf && caption) caption = [{ type: 'text', text: caption.map(displayInlineText).join('') }];
                const alt = label(node.assetId, !transportCaption && !isMarkdown ? assetCaptionText(node.caption) ?? node.alt : node.alt);
                const details = caption?.length === 1 && caption[0].type === 'text' && caption[0].text === alt ? undefined : caption;
                if (!available(node.assetId)) {
                    missing(node.assetId, path);
                    if (isPdf) return { type: 'unsupported', sourceType: 'missing-image', label: `${strings.unsupportedContent} · missing-image`, text: caption?.map(displayInlineText).join('') || label(node.assetId, node.alt) };
                    return { type: 'placeholder', ...(isMarkdown ? { enclosure: 'brackets' as const } : {}), text: isMarkdown ? `Image unavailable: ${alt}` : `${isEn ? 'Attachment missing' : '附件缺失'} · ${alt}`, badge: 'MISSING', ...(details ? { details } : {}) };
                }
                return { type: 'image', resourceId: node.assetId, alt, ...(caption ? { caption } : {}) };
            }
            case 'file': {
                const name = isPdf ? assetPresentation(assets.get(node.assetId), node.label, 'Attachment').label : label(node.assetId, node.label, 'Attachment');
                if (isPdf) {
                    const asset = assets.get(node.assetId);
                    if (!asset) return { type: 'unsupported', sourceType: 'missing-file', label: `${strings.unsupportedContent} · missing-file`, text: [name, node.description?.map(n => extractInlineText(n, { citationLabel: id => source(id).label })).join('')].filter(Boolean).join('\n\n') };
                    const badge = fileKind(asset);
                    const size = humanBytes(asset.sizeBytes, strings.sizeUnknown);
                    return { type: 'file', resourceId: node.assetId, label: name, badge, size, metadata: `${badge} · ${size}`, openLabel: name, ...(node.description?.length ? { description: [{ type: 'text', text: node.description.map(n => extractInlineText(n, { citationLabel: id => source(id).label })).join('') }] } : {}) };
                }
                if (!available(node.assetId)) {
                    missing(node.assetId, path);
                    return { type: 'placeholder', ...(isMarkdown ? { enclosure: 'brackets' as const } : {}), text: isMarkdown ? `Attachment unavailable: ${name}` : `${isEn ? 'Attachment missing' : '附件缺失'} · ${name}`, badge: 'MISSING', ...(node.description ? { details: inlines(node.description, path) } : {}) };
                }
                const badge = name.match(/\.([a-z0-9]+)$/i)?.[1].toUpperCase() ?? 'FILE';
                return { type: 'file', resourceId: node.assetId, label: name, badge, openLabel: `${isEn ? 'Open or download' : '点击打开或下载'} ${name}`, ...(node.description ? { description: inlines(node.description, path) } : {}) };
            }
            case 'thought':
                if (isPdf) return { type: 'note', ...(node.kind === 'reasoning' || node.kind === 'summary' || node.kind === 'progress' ? { title: node.kind === 'summary' ? strings.thinkingSummary : node.kind === 'progress' ? strings.thinkingProgress : strings.thinkingProcess } : {}), blocks: blocks(node.blocks, `${path}/thought`) };
                return { type: 'disclosure', title: (isMarkdown ? '🧠 ' : '') + (node.kind === 'summary' ? strings.thinkingSummary : node.kind === 'progress' ? strings.thinkingProgress : strings.thinkingProcess), initiallyCollapsed: options.thoughtInitiallyCollapsed ?? isMarkdown, blocks: blocks(node.blocks, `${path}/thought`) };
            case 'thematicBreak': return { type: 'thematicBreak' };
            case 'unknown':
                if (!isPdf) diagnostics.push({ severity: 'info', code: `${profile.toUpperCase()}_UNKNOWN_BLOCK`, message: `unknown block rendered visibly (sourceType=${node.sourceType})`, path });
                return { type: 'unsupported', sourceType: node.sourceType, label: `${isPdf ? strings.unsupportedContent : 'Unsupported'} · ${node.sourceType}`, text: node.text };
        }
    };
    const messages = bundle.conversation.messages.map((message, index) => {
        const headings = { user: '👤 You', assistant: '🤖 Assistant', system: '⚙️ System', developer: '🛠 Developer', unknown: 'Message' };
        const bubble = message.role === 'user';
        const plain = message.blocks.map(b => extractBlockText(b, isPdf ? { citationLabel: id => source(id).label } : {})).join('\n');
        const folded = bubble && (plain.length > 280 || plain.split('\n').length > 5);
        const composedBlocks = blocks(message.blocks, `message:${message.id}`);
        if (isPdf) {
            const prefix = message.role === 'system' ? strings.systemMessage : message.role === 'developer' ? strings.developerMessage : message.role === 'unknown' ? (message.author?.rawRole ? `${strings.unknownRole}: ${message.author.rawRole}` : strings.unknownRole) : undefined;
            if (prefix) composedBlocks.unshift({ type: 'note', children: [{ type: 'text', text: prefix }] });
            if (message.citationIds?.length) composedBlocks.push({ type: 'note', children: [{ type: 'text', text: message.citationIds.map(id => citations.has(id) ? source(id).label : id).join(' · ') || strings.sources }] });
            applyPdfBlockLayout(composedBlocks, bubble, false);
        }
        const next = bundle.conversation.messages[index + 1];
        return {
            type: 'message' as const, id: message.id, anchor: `turn-${bubble ? 'user' : 'model'}-${index}`,
            variant: bubble ? 'bubble' as const : 'flow' as const,
            ...(isMarkdown ? { heading: { level: 2 as const, text: headings[message.role] } } : {}),
            blocks: composedBlocks,
            ...(isPdf ? {
                measurementText: plain,
                ...(message.author?.model && !bubble ? { modelLabel: message.author.model } : {}),
                minWidthCards: composedBlocks.flatMap(b => b.type === 'file' ? [{ label: b.label, metadata: b.metadata! }] : []),
                gapAfterPt: next ? (message.role !== 'user' && next.role === 'user' ? visual.spacing.turn : visual.spacing.section) * 0.75 : 0,
            } : {}),
            ...(!isPdf && message.citationIds?.length ? { sources: { type: 'sources' as const, ...(isMarkdown ? { heading: [{ type: 'text' as const, text: '🌐 ' }, { type: 'strong' as const, children: [{ type: 'text' as const, text: 'Sources:' }] }] } : {}), items: message.citationIds.map((id, index) => ({ ...source(id), ...(isMarkdown ? { prefix: `[${index + 1}]` } : {}) })) } } : {}),
            ...(!isPdf && !isMarkdown && folded ? { folding: { initiallyCollapsed: true, moreLabel: isEn ? 'Show more' : '展开', lessLabel: isEn ? 'Show less' : '收起' } } : {}),
        };
    });
    const conversation = bundle.conversation;
    const title = (isPdf ? conversation.title ?? 'Untitled conversation' : conversation.title || (isMarkdown ? conversation.key.conversationId : 'Gemini Conversation')).replace(/[\r\n]+/g, ' ').trim();
    if (isMarkdown && !options.exportedAt) throw new TypeError('Markdown composition requires an explicit export time');
    return { document: {
        schemaVersion: 1, profile: { id: profile, version: 1 }, language: isEn ? 'en' : 'zh-CN', theme: options.theme ?? 'dark',
        header: { title, metadata: isPdf ? `${conversation.key.providerId} · ${(conversation.updatedAt ?? conversation.createdAt)?.slice(0, 10) || strings.dateUnknown} · ${messages.length} messages` : `${conversation.key.providerId}${conversation.createdAt ? ' · ' + conversation.createdAt.slice(0, 10) : ''} · ${messages.length} ${isEn ? 'messages' : '条消息'}` },
        ...(isPdf ? { pdfLayout: pdfLayoutPolicy() } : {}),
        ...(isMarkdown ? { frontMatter: [
            { key: 'title', value: title }, { key: 'id', value: conversation.key.conversationId }, { key: 'provider', value: conversation.key.providerId },
            ...(conversation.url ? [{ key: 'url', value: conversation.url }] : []),
            ...(conversation.createdAt ? [{ key: 'date', value: conversation.createdAt }] : []),
            ...(conversation.updatedAt ? [{ key: 'updated', value: conversation.updatedAt }] : []),
            { key: 'exported', value: options.exportedAt! }, { key: 'tags', value: [`${conversation.key.providerId}-export`] },
        ] } : {}),
        mathFallbackLabel: strings.mathFallback, messages,
        ...(!messages.length ? { emptyNotice: isEn ? 'Empty conversation or fetch failed.' : '暂无对话记录或拉取失败。' } : {}),
    }, diagnostics };
}

export function isArchiveResourceRef(ref: string): boolean {
    return Boolean(ref) && !/(^\/|\\|^[a-z][a-z\d+.-]*:|(^|\/)\.\.(\/|$))/i.test(ref);
}

function displayInlineText(node: DisplayInline): string {
    if ('children' in node) return node.children.map(displayInlineText).join('');
    switch (node.type) {
        case 'text': case 'placeholder': return node.text;
        case 'inlineCode': return node.code;
        case 'citation': return node.label;
        case 'image': return node.alt;
        case 'inlineMath': return node.source;
        case 'lineBreak': return '\n';
    }
}
function humanBytes(value: number | undefined, unknown: string): string {
    if (value == null || !Number.isFinite(value)) return unknown;
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB', 'TB']; let n = value / 1024; let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n >= 10 ? n.toFixed(1) : n.toFixed(2)} ${units[i]}`;
}
function fileKind(asset: Asset): string {
    const subtype = asset.mimeType?.toLowerCase().split('/')[1];
    return subtype ? subtype.replace(/^x-/, '').toUpperCase() : asset.name?.match(/\.([^.]+)$/)?.[1]?.toUpperCase() ?? asset.kind.toUpperCase();
}
function pdfLayoutPolicy(): import('./ast.js').PdfLayoutPolicy {
    return {
        page: { widthMm: 210, heightMm: 297, topMm: 18.5, bottomMm: 18, sideMm: 22, contentWidthMm: 166, proseWidthMm: 166 * visual.content.proseWidth / visual.content.maxWidth },
        bubble: { maxWidthRatio: 0.85, compactHeightPt: 120, minInnerWidthPt: 28, paddingXPt: 12.5, paddingYPt: 8.4 },
        figure: { maxPageHeightRatio: 0.60, captionMaxWidthMm: 115 },
        textLanguage: 'zh', headerGapPt: visual.spacing.inline * 0.75, bodyGapPt: visual.spacing.section * 0.75,
    };
}
function applyPdfBlockLayout(nodes: DisplayBlock[], bubble: boolean, nested: boolean): void {
    nodes.forEach((node, index) => {
        const previous = nodes[index - 1]; const next = nodes[index + 1];
        const gap = !previous ? 0 : node.type === 'heading' || node.type === 'thematicBreak' || previous.type === 'thematicBreak' ? 'section'
            : previous.type === 'heading' || previous.type === 'paragraph' && (node.type === 'paragraph' || node.type === 'list') || previous.type === 'list' && node.type === 'paragraph' ? 'paragraph' : 'block';
        node.layout = {
            gapBeforePt: gap === 0 ? 0 : visual.spacing[gap] * 0.75,
            keepWithNext: node.type === 'heading' || !nested && node.type === 'paragraph' && Boolean(next && ['table', 'image', 'math', 'code'].includes(next.type)),
            width: ['note', 'unsupported'].includes(node.type) ? 'reading' : ['code', 'math', 'table', 'image', 'file'].includes(node.type) ? 'full' : bubble ? 'container' : 'reading',
        };
        if (node.type === 'list') node.items.forEach(item => applyPdfBlockLayout(item.blocks, bubble, true));
        else if (node.type === 'quote' || node.type === 'disclosure') applyPdfBlockLayout(node.blocks, bubble, true);
        else if (node.type === 'note' && node.blocks) applyPdfBlockLayout(node.blocks, bubble, true);
    });
}
