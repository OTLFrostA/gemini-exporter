import type { PhrasingContent } from 'mdast';
import {
    GEMINI_NODE_TYPES,
    type GeminiSourceAttribution,
    type GeminiStructuredDocument,
    type GeminiStructuredNode,
    type GeminiTextNode,
} from './structuredTypes.js';
import { parseMarkdownAst } from '../../shared/markdown/index.js';
import { projectCandidateParagraphs, type CandidateMarkdownIndex } from './candidateMarkdown.js';

export function validGeminiTextRange(text: string, start: number, end: number): boolean {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || start > end) return false;
    return [start, end].every(boundary => {
        const before = text.charCodeAt(boundary - 1), after = text.charCodeAt(boundary);
        return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
    });
}

/** Source quotes use the selected response's Markdown syntax. Restrict recovery
 * to one inline paragraph; never normalize code whitespace or punctuation. */
function quoteTextCandidates(markdown: string): string[] {
    const root = parseMarkdownAst(markdown);
    const paragraph = root.children[0];
    if (root.children.length !== 1 || paragraph?.type !== 'paragraph'
        || paragraph.position?.start.offset !== 0 || paragraph.position.end.offset !== markdown.length) return [];
    const plain: string[] = [], gemini: string[] = [];
    const inlines = (nodes: readonly PhrasingContent[]): boolean => {
        for (const node of nodes) {
            if (node.type === 'text') {
                plain.push(node.value);
                // Gemini uses bold with a closing fullwidth parenthesis between Han
                // characters. CommonMark leaves those delimiters in the text node.
                const raw = markdown.slice(node.position?.start.offset, node.position?.end.offset);
                gemini.push(raw === node.value
                    ? node.value.replace(/(\p{Script=Han})\*\*([^*\r\n]+）)\*\*(?=\p{Script=Han})/gu, '$1$2')
                    : node.value);
            } else if (node.type === 'inlineCode' || node.type === 'break') {
                const text = node.type === 'break' ? '\n' : node.value;
                plain.push(text);
                gemini.push(text);
            } else if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'delete' || node.type === 'link') {
                if (!inlines(node.children)) return false;
            } else return false;
        }
        return true;
    };
    if (!inlines(paragraph.children)) return [];
    const text = plain.join(''), geminiText = gemini.join('');
    return geminiText === text ? [text] : [text, geminiText];
}

/** Replace only invalid coordinates. A quote must either have one exact match
 * across the native document or map through a unique, identical full paragraph
 * in the selected Markdown and native body. Valid coordinates never change. */
export function recoverGeminiSourceRanges(
    document: GeminiStructuredDocument,
    sources: readonly GeminiSourceAttribution[],
    candidateInput?: string | CandidateMarkdownIndex,
) {
    if (!sources.some(source => source.quote)) return { document, recovered: 0 };
    const nodes: GeminiTextNode[] = [];
    const collect = (children: readonly GeminiStructuredNode[]): void => children.forEach(node => {
        if (node.nodeType === GEMINI_NODE_TYPES.TEXT_BLOCK) nodes.push(node);
        else if ('children' in node) collect(node.children);
        else if ('items' in node) node.items.forEach(item => collect(item.children));
        else if ('rows' in node) node.rows.forEach(row => row.cells.forEach(cell => collect(cell.children)));
    });
    collect(document.children);
    const invalidIds = new Set(nodes.flatMap(node => (node.annotations ?? []).flatMap(annotation =>
        annotation.type === 'source' && !validGeminiTextRange(node.text, annotation.start, annotation.end) ? annotation.sourceIds : [])));
    if (!invalidIds.size) return { document, recovered: 0 };
    const candidateMarkdown = typeof candidateInput === 'string' ? candidateInput : candidateInput?.rawCandidateText;
    const paragraphs = typeof candidateInput === 'string'
        ? projectCandidateParagraphs(candidateInput)
        : candidateInput?.paragraphs() ?? [];
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
        for (const quote of quoteTextCandidates(verified.text)) {
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
            if (matches.length) break;
        }
    }
    let recovered = 0;
    const visit = (children: GeminiStructuredNode[]): GeminiStructuredNode[] => children.map(node => {
        if (node.nodeType === GEMINI_NODE_TYPES.TEXT_BLOCK) return { ...node, annotations: node.annotations?.map(annotation => {
            if (annotation.type !== 'source' || validGeminiTextRange(node.text, annotation.start, annotation.end)) return annotation;
            const anchor = anchors.get(annotation.sourceIds[0]);
            if (!anchor || anchor.node !== node || !annotation.sourceIds.every(id => {
                const other = anchors.get(id);
                return other?.node === node && other.start === anchor.start && other.end === anchor.end;
            })) return annotation;
            recovered++;
            return { ...annotation, start: anchor.start, end: anchor.end };
        }) };
        if (node.nodeType === 'fragment' || node.nodeType === 'paragraph' || node.nodeType === GEMINI_NODE_TYPES.BLOCKQUOTE)
            return { ...node, children: visit(node.children) };
        if (node.nodeType === GEMINI_NODE_TYPES.ORDERED_LIST || node.nodeType === GEMINI_NODE_TYPES.UNORDERED_LIST)
            return { ...node, items: node.items.map(item => ({ ...item, children: visit(item.children) })) };
        if (node.nodeType === GEMINI_NODE_TYPES.TABLE) return { ...node, rows: node.rows.map(row => ({ ...row,
            cells: row.cells.map(cell => ({ ...cell, children: visit(cell.children) })),
        })) };
        return node;
    });
    return { document: anchors.size ? { children: visit(document.children) } : document, recovered };
}
