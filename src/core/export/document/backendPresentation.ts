import type { DisplayBlock, DisplayInline, DisplayMessage, DocumentAst } from './ast.js';
import type { RenderOptions } from './renderOptions.js';
import { getRendererStrings } from './renderStrings.js';

export function inlineText(node: DisplayInline): string {
    if ('children' in node) return node.children.map(inlineText).join('');
    switch (node.type) {
        case 'text': case 'placeholder': return node.text;
        case 'inlineCode': return node.code;
        case 'citation': return node.label;
        case 'image': return node.alt;
        case 'inlineMath': return node.source;
        case 'lineBreak': return '\n';
    }
}
export function blockText(node: DisplayBlock): string {
    switch (node.type) {
        case 'paragraph': case 'heading': return node.children.map(inlineText).join('');
        case 'list': return node.items.map(item => item.blocks.map(blockText).join('\n')).join('\n');
        case 'quote': case 'disclosure': return node.blocks.map(blockText).join('\n');
        case 'code': return node.code;
        case 'math': return node.source;
        case 'table': return [...node.headerRows, ...node.rows].map(row => row.map(cell => cell.children.map(inlineText).join('')).join(' | ')).join('\n');
        case 'image': return node.alt;
        case 'file': return node.label;
        case 'placeholder': case 'unsupported': return node.text;
        case 'note': return node.blocks?.map(blockText).join('\n') ?? node.children?.map(inlineText).join('') ?? '';
        case 'thematicBreak': return '';
    }
}
export function codeHeader(node: Extract<DisplayBlock, { type: 'code' }>, format: 'html' | 'markdown' | 'pdf'): string {
    if (!node.showHeader) return '';
    if (format === 'markdown') return [node.filename, node.meta].filter(Boolean).join(' · ');
    const language = node.language || 'text';
    const title = node.filename ? node.filename + (language !== 'text' ? ` · ${language}` : '') : language;
    return title + (format === 'pdf' && node.meta ? ` · ${node.meta}` : '');
}
export function fileBadge(node: Extract<DisplayBlock, { type: 'file' }>, useMediaType = true): string {
    const subtype = useMediaType && node.mediaType?.toLowerCase().split('/')[1];
    return subtype ? subtype.replace(/^x-/, '').toUpperCase() : node.label.match(/\.([^.]+)$/)?.[1]?.toUpperCase() ?? node.kind.toUpperCase();
}
export function humanBytes(value: number | undefined, unknown: string): string {
    if (value == null || !Number.isFinite(value) || value < 0) return unknown;
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB', 'TB']; let n = value / 1024; let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n >= 10 ? n.toFixed(1) : n.toFixed(2)} ${units[i]}`;
}
export function disclosureTitle(node: Extract<DisplayBlock, { type: 'disclosure' }>, options: RenderOptions): string {
    const strings = getRendererStrings(options.locale ?? 'en');
    return node.title ?? (node.kind === 'summary' ? strings.thinkingSummary : node.kind === 'progress' ? strings.thinkingProgress : strings.thinkingProcess);
}
export function headerMetadata(document: DocumentAst, locale: 'zh' | 'en', pdf = false): string {
    const strings = getRendererStrings(locale);
    return `${document.header.providerLabel}${document.header.date ? ' · ' + document.header.date : pdf ? ' · ' + strings.dateUnknown : ''} · ${document.header.messageCount} ${pdf || locale === 'en' ? 'messages' : '条消息'}`;
}
export function messageLabel(message: DisplayMessage, locale: 'zh' | 'en'): string {
    const en = { you: 'You', assistant: 'Assistant', system: 'System', developer: 'Developer', unknown: 'Message' };
    const zh = { you: '你', assistant: '助手', system: '系统', developer: '开发者', unknown: '消息' };
    return message.heading?.text ?? (locale === 'zh' ? zh : en)[message.label];
}
