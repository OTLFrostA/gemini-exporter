import type { PhrasingContent } from 'mdast';
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

/** Replace only invalid coordinates, using a candidate-verified source quote
 * that occurs exactly once in the whole native document. Missing/ambiguous
 * quotes and different source identities retain the original partial path. */
export function recoverGeminiSourceRanges(document: GeminiStructuredDocument, sources: readonly GeminiSourceAttribution[]) {
    if (!sources.some(source => source.quotedText)) return { document, recovered: 0 };
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
    const anchors = new Map<string, { node: GeminiTextNode; start: number; end: number }>();
    for (const source of sources) {
        if (!source.quotedText || !invalidIds.has(source.sourceId)) continue;
        const quote = quoteText(source.quotedText);
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
