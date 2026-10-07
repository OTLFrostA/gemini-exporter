import type { BlockNode, TableBlock } from '../../content/blocks.js';
import type { InlineNode } from '../../content/inline.js';
import type { CanonicalConversationBundle } from '../canonical/conversation.js';
import { assetPresentation, assetCaptionText, isHumanMeaningfulFilename } from '../canonical/assetPresentation.js';
import { citationDisplayLabel } from '../canonical/citations.js';
import { getRendererStrings } from '../canonical/rendererStrings.js';
import { extractBlockText } from '../canonical/unknownFallback.js';
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
    profile: 'html' | 'markdown',
    options: CompositionOptions = {},
): { document: DocumentAst; diagnostics: DocumentDiagnostic[] } {
    const isMarkdown = profile === 'markdown';
    const isEn = options.lang === 'en' || (isMarkdown && options.lang === undefined);
    const strings = getRendererStrings(isEn ? 'en' : 'zh');
    const assets = new Map(bundle.assets.map(a => [a.id, a]));
    const citations = new Map(bundle.citations.map((c, index) => [c.id, { ...c, number: index + 1 }]));
    const diagnostics: DocumentDiagnostic[] = [];
    const available = (id: string): boolean => {
        const ref = bindings[id];
        return Boolean(ref && (isMarkdown ? isArchiveResourceRef(ref) : sanitizeUrl(ref, true) !== '#'));
    };
    const source = (id: string, explicit?: string) => {
        const c = citations.get(id);
        const label = c ? citationDisplayLabel(c, c.number, explicit) : (explicit ?? id);
        return { id, label, ...(c?.url ? { href: c.url } : {}) };
    };
    // Legacy normalizers can copy the transport filename into alt/caption.
    // Only that exact known alias is filtered; authored prose/numeric captions survive.
    const isTransportAlias = (id: string, value: string | undefined): boolean =>
        value !== undefined && value === assets.get(id)?.name && !isHumanMeaningfulFilename(value);
    const label = (id: string, explicit?: string, fallback = 'Image'): string =>
        (!isTransportAlias(id, explicit) && explicit?.trim()) || assetPresentation(assets.get(id), undefined, fallback).label;
    const missing = (id: string, path: string, inline = false): void => {
        diagnostics.push({ severity: 'warning', code: `${profile.toUpperCase()}_ASSET_UNRESOLVED`, message: `${inline ? 'inline image ' : ''}asset ${id} has no resolvable offline URL; rendered as a visible placeholder`, path });
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
                const alt = label(node.assetId, node.alt);
                if (!available(node.assetId)) {
                    missing(node.assetId, path, true);
                    return { type: 'placeholder', ...(isMarkdown ? { enclosure: 'brackets' as const } : {}), text: isMarkdown ? `Image unavailable: ${alt}` : `${isEn ? 'Image missing' : '图片缺失'} · ${alt}` };
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
            return { type: 'table', columnAlignments, ...(node.caption ? { caption: inlines(node.caption, path) } : {}), headerRows: [headers ? projected[0] : Array.from({ length: width }, (_, column) => blank(column))], rows: projected.slice(headers ? 1 : 0) };
        }
        return { type: 'table', columnAlignments, ...(node.caption ? { caption: inlines(node.caption, path) } : {}), headerRows: rows.slice(0, headers), rows: rows.slice(headers) };
    };
    const blocks = (nodes: BlockNode[], path: string): DisplayBlock[] => nodes.map((node, i) => block(node, `${path}/block:${i}`));
    const block = (node: BlockNode, path: string): DisplayBlock => {
        switch (node.type) {
            case 'paragraph': return { type: 'paragraph', children: inlines(node.children, path) };
            case 'heading': return { type: 'heading', level: node.level, children: inlines(node.children, path) };
            case 'list': return { type: 'list', ordered: node.ordered, ...(node.start !== undefined ? { start: node.start } : {}), items: node.items.map((item, i) => ({ blocks: blocks(item.blocks, `${path}/item:${i}`) })) };
            case 'quote': return { type: 'quote', blocks: blocks(node.blocks, `${path}/quote`) };
            case 'code': {
                const language = node.language || (isMarkdown ? '' : 'text');
                const header = isMarkdown ? [node.filename, node.meta].filter(Boolean).join(' · ') : node.filename ? (language !== 'text' ? `${node.filename} · ${language}` : node.filename) : language;
                return { type: 'code', language, header, code: node.code, ...(!isMarkdown && node.meta !== undefined ? { meta: node.meta } : {}), ...(!isMarkdown ? { copy: { label: isEn ? 'Copy' : '复制', title: 'Copy Code' } } : {}) };
            }
            case 'math': return { type: 'math', source: node.source };
            case 'table': return table(node, path);
            case 'image': {
                // Explicit captions are authored content, never opaque-filename candidates.
                const fallbackCaption = assetPresentation(assets.get(node.assetId), node.alt).caption;
                const transportCaption = node.caption?.length === 1 && node.caption[0].type === 'text' && isTransportAlias(node.assetId, node.caption[0].text);
                const caption = node.caption?.length && !transportCaption ? inlines(node.caption, path) : fallbackCaption ? [{ type: 'text' as const, text: fallbackCaption }] : undefined;
                const alt = label(node.assetId, !transportCaption && !isMarkdown ? assetCaptionText(node.caption) ?? node.alt : node.alt);
                const details = caption?.length === 1 && caption[0].type === 'text' && caption[0].text === alt ? undefined : caption;
                if (!available(node.assetId)) {
                    missing(node.assetId, path);
                    return { type: 'placeholder', ...(isMarkdown ? { enclosure: 'brackets' as const } : {}), text: isMarkdown ? `Image unavailable: ${alt}` : `${isEn ? 'Attachment missing' : '附件缺失'} · ${alt}`, badge: 'MISSING', ...(details ? { details } : {}) };
                }
                return { type: 'image', resourceId: node.assetId, alt, ...(caption ? { caption } : {}) };
            }
            case 'file': {
                const name = label(node.assetId, node.label, 'Attachment');
                if (!available(node.assetId)) {
                    missing(node.assetId, path);
                    return { type: 'placeholder', ...(isMarkdown ? { enclosure: 'brackets' as const } : {}), text: isMarkdown ? `Attachment unavailable: ${name}` : `${isEn ? 'Attachment missing' : '附件缺失'} · ${name}`, badge: 'MISSING', ...(node.description ? { details: inlines(node.description, path) } : {}) };
                }
                const badge = name.match(/\.([a-z0-9]+)$/i)?.[1].toUpperCase() ?? 'FILE';
                return { type: 'file', resourceId: node.assetId, label: name, badge, openLabel: `${isEn ? 'Open or download' : '点击打开或下载'} ${name}`, ...(node.description ? { description: inlines(node.description, path) } : {}) };
            }
            case 'thought': return { type: 'disclosure', title: (isMarkdown ? '🧠 ' : '') + (node.kind === 'summary' ? strings.thinkingSummary : node.kind === 'progress' ? strings.thinkingProgress : strings.thinkingProcess), initiallyCollapsed: options.thoughtInitiallyCollapsed ?? isMarkdown, blocks: blocks(node.blocks, `${path}/thought`) };
            case 'thematicBreak': return { type: 'thematicBreak' };
            case 'unknown':
                diagnostics.push({ severity: 'info', code: `${profile.toUpperCase()}_UNKNOWN_BLOCK`, message: `unknown block rendered visibly (sourceType=${node.sourceType})`, path });
                return { type: 'unsupported', sourceType: node.sourceType, label: `Unsupported · ${node.sourceType}`, text: node.text };
        }
    };
    const messages = bundle.conversation.messages.map((message, index) => {
        const headings = { user: '👤 You', assistant: '🤖 Assistant', system: '⚙️ System', developer: '🛠 Developer', unknown: 'Message' };
        const bubble = message.role === 'user';
        const plain = message.blocks.map(b => extractBlockText(b)).join('\n');
        const folded = bubble && (plain.length > 280 || plain.split('\n').length > 5);
        return {
            type: 'message' as const, id: message.id, anchor: `turn-${bubble ? 'user' : 'model'}-${index}`,
            variant: bubble ? 'bubble' as const : 'flow' as const,
            ...(isMarkdown ? { heading: { level: 2 as const, text: headings[message.role] } } : {}),
            blocks: blocks(message.blocks, `message:${message.id}`),
            ...(message.citationIds?.length ? { sources: { type: 'sources' as const, ...(isMarkdown ? { heading: [{ type: 'text' as const, text: '🌐 ' }, { type: 'strong' as const, children: [{ type: 'text' as const, text: 'Sources:' }] }] } : {}), items: message.citationIds.map((id, index) => ({ ...source(id), ...(isMarkdown ? { prefix: `[${index + 1}]` } : {}) })) } } : {}),
            ...(!isMarkdown && folded ? { folding: { initiallyCollapsed: true, moreLabel: isEn ? 'Show more' : '展开', lessLabel: isEn ? 'Show less' : '收起' } } : {}),
        };
    });
    const conversation = bundle.conversation;
    const title = (conversation.title || (isMarkdown ? conversation.key.conversationId : 'Gemini Conversation')).replace(/[\r\n]+/g, ' ').trim();
    if (isMarkdown && !options.exportedAt) throw new TypeError('Markdown composition requires an explicit export time');
    return { document: {
        schemaVersion: 1, profile: { id: profile, version: 1 }, language: isEn ? 'en' : 'zh-CN', theme: options.theme ?? 'dark',
        header: { title: title, metadata: `${conversation.key.providerId}${conversation.createdAt ? ' · ' + conversation.createdAt.slice(0, 10) : ''} · ${messages.length} ${isEn ? 'messages' : '条消息'}` },
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
