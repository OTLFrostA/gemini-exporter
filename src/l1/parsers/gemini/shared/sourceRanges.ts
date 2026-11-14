import type { PhrasingContent, RootContent } from 'mdast';
import type { GeminiStructuredDocument, GeminiStructuredNode, GeminiTextNode } from '../rpc/structuredContent.js';
import type { GeminiSourceAttribution } from '../rpc/sourceAttributions.js';
import { parseMarkdownAst } from '../../shared/markdown/index.js';

export function validGeminiTextRange(text: string, start: number, end: number): boolean {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || start > end) return false;
    return [start, end].every(boundary => {
        const before = text.charCodeAt(boundary - 1), after = text.charCodeAt(boundary);
        return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
    });
}

/** Source quotes use the selected response's Markdown syntax. Restrict recovery
 * to one inline paragraph; never normalize code whitespace or punctuation. */
function quoteText(markdown: string): string | null {
    const root = parseMarkdownAst(markdown);
    const paragraph = root.children[0];
    if (root.children.length !== 1 || paragraph?.type !== 'paragraph'
        || paragraph.position?.start.offset !== 0 || paragraph.position.end.offset !== markdown.length) return null;
    const inlines = (nodes: readonly PhrasingContent[]): string | null => {
        const parts: string[] = [];
        for (const node of nodes) {
            if (node.type === 'text' || node.type === 'inlineCode') parts.push(node.value);
            else if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'delete' || node.type === 'link') {
                const children = inlines(node.children);
                if (children === null) return null;
                parts.push(children);
            } else if (node.type === 'break') parts.push('\n');
            else return null;
        }
        return parts.join('');
    };
    return inlines(paragraph.children);
}

/** Project source positions through a complete Markdown paragraph, rather than
 * reparsing a quote that may start/end inside a code span or style delimiter.
 * Only unchanged literal text and exact code contents have a proven position
 * mapping. Escapes, entities, padded/multiline code and unsupported nodes refuse
 * this path instead of approximating coordinates. */
function candidateParagraphs(markdown: string) {
    const paragraphs: Array<{ text: string; start: number; end: number; spans: Array<{ start: number; end: number; offset: number }> }> = [];
    const visit = (nodes: readonly (RootContent | PhrasingContent)[]): void => {
        for (const block of nodes) {
            if (block.type !== 'paragraph' && block.type !== 'heading' && block.type !== 'tableCell') {
                if ('children' in block) visit(block.children);
                continue;
            }
            const blockStart = block.position?.start.offset, blockEnd = block.position?.end.offset;
            if (blockStart === undefined || blockEnd === undefined) continue;
            let text = '';
            const spans: Array<{ start: number; end: number; offset: number }> = [];
            const inlines = (children: readonly PhrasingContent[]): boolean => {
                for (const node of children) {
                    if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'delete' || node.type === 'link') {
                        if (!inlines(node.children)) return false;
                        continue;
                    }
                    let start = node.position?.start.offset;
                    const end = node.position?.end.offset;
                    if (start === undefined || end === undefined || (node.type !== 'text' && node.type !== 'inlineCode')) return false;
                    if (node.type === 'inlineCode') {
                        const raw = markdown.slice(start, end);
                        const delimiter = /^`+/.exec(raw)?.[0];
                        if (!delimiter || raw.slice(delimiter.length, -delimiter.length) !== node.value) return false;
                        start += delimiter.length;
                    } else if (markdown.slice(start, end) !== node.value) return false;
                    spans.push({ start, end: start + node.value.length, offset: text.length });
                    text += node.value;
                }
                return true;
            };
            if (inlines(block.children) && text) paragraphs.push({ text, start: blockStart, end: blockEnd, spans });
        }
    };
    visit(parseMarkdownAst(markdown).children);
    return paragraphs;
}

/** Replace only invalid coordinates. A quote must either have one exact match
 * across the native document or map through a unique, identical full paragraph
 * in the selected Markdown and native body. Valid coordinates never change. */
export function recoverGeminiSourceRanges(document: GeminiStructuredDocument, sources: readonly GeminiSourceAttribution[], candidateMarkdown?: string) {
    if (!sources.some(source => source.quote)) return { document, recovered: 0 };
    const nodes: GeminiTextNode[] = [];
    const collect = (children: readonly GeminiStructuredNode[]): void => children.forEach(node => {
        if (node.nodeType === 18) nodes.push(node);
        else if ('children' in node) collect(node.children);
        else if ('items' in node) node.items.forEach(item => collect(item.children));
        else if ('rows' in node) node.rows.forEach(row => row.cells.forEach(cell => collect(cell.children)));
    });
    collect(document.children);
    const invalidIds = new Set(nodes.flatMap(node => (node.annotations ?? []).flatMap(annotation =>
        annotation.type === 'source' && !validGeminiTextRange(node.text, annotation.start, annotation.end) ? annotation.sourceIds : [])));
    if (!invalidIds.size) return { document, recovered: 0 };
    const paragraphs = candidateMarkdown === undefined ? [] : candidateParagraphs(candidateMarkdown);
    const anchors = new Map<string, { node: GeminiTextNode; start: number; end: number }>();
    for (const source of sources) {
        if (!source.quote || !invalidIds.has(source.sourceId)) continue;
        const verified = source.quote;
        if (candidateMarkdown?.slice(verified.start, verified.end) === verified.text) {
            const paragraph = paragraphs.find(p => p.start <= verified.start && p.end >= verified.end);
            if (paragraph && paragraphs.filter(p => p.text === paragraph.text).length === 1) {
                const owners = nodes.filter(node => node.text === paragraph.text);
                const spans = paragraph.spans.filter(s => s.start < verified.end && s.end > verified.start);
                const first = spans[0], last = spans[spans.length - 1];
                if (owners.length === 1 && first && last) {
                    const start = first.offset + Math.max(verified.start - first.start, 0);
                    const end = last.offset + Math.min(verified.end, last.end) - last.start;
                    if (start < end && validGeminiTextRange(owners[0].text, start, end)) {
                        anchors.set(source.sourceId, { node: owners[0], start, end });
                        continue;
                    }
                }
            }
        }
        const quote = quoteText(verified.text);
        if (!quote) continue;
        const matches: Array<{ node: GeminiTextNode; start: number; end: number }> = [];
        for (const node of nodes) {
            let start = node.text.indexOf(quote);
            while (start >= 0 && matches.length < 2) {
                const end = start + quote.length;
                if (validGeminiTextRange(node.text, start, end)) matches.push({ node, start, end });
                start = node.text.indexOf(quote, start + 1);
            }
            if (matches.length > 1) break;
        }
        if (matches.length === 1) anchors.set(source.sourceId, matches[0]);
    }
    let recovered = 0;
    const visit = (children: GeminiStructuredNode[]): GeminiStructuredNode[] => children.map(node => {
        if (node.nodeType === 18) return { ...node, annotations: node.annotations?.map(annotation => {
            if (annotation.type !== 'source' || validGeminiTextRange(node.text, annotation.start, annotation.end)) return annotation;
            const anchor = anchors.get(annotation.sourceIds[0]);
            if (!anchor || anchor.node !== node || !annotation.sourceIds.every(id => {
                const other = anchors.get(id);
                return other?.node === node && other.start === anchor.start && other.end === anchor.end;
            })) return annotation;
            recovered++;
            return { ...annotation, start: anchor.start, end: anchor.end };
        }) };
        if (node.nodeType === 'fragment' || node.nodeType === 'paragraph' || node.nodeType === 15)
            return { ...node, children: visit(node.children) };
        if (node.nodeType === 14 || node.nodeType === 20)
            return { ...node, items: node.items.map(item => ({ ...item, children: visit(item.children) })) };
        if (node.nodeType === 17) return { ...node, rows: node.rows.map(row => ({ ...row,
            cells: row.cells.map(cell => ({ ...cell, children: visit(cell.children) })),
        })) };
        return node;
    });
    return { document: anchors.size ? { children: visit(document.children) } : document, recovered };
}
