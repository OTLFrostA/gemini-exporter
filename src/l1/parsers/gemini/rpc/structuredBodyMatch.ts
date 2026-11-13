import type { RootContent, PhrasingContent } from 'mdast';
import type { GeminiStructuredDocument, GeminiStructuredNode } from './structuredContent.js';
import { parseMarkdownAst } from '../../shared/markdown/index.js';

/** Used only to disambiguate alternative document bodies against the selected
 * candidate's independent Markdown. Preserve punctuation and code whitespace;
 * remove only provider citation markers, never arbitrary Markdown characters. */
function prose(value: string): string {
    return value.replace(/\[cite_start\]|\[cite:\s*[\d., -]*\]/g, '').replace(/\s+/g, ' ').trim();
}
function markdownText(nodes: readonly (RootContent | PhrasingContent)[], source: string,
    decorations: readonly { marker: string; text: string }[], hasMath: boolean): string | null {
    const parts: string[] = [];
    for (const node of nodes) {
        if (node.type === 'definition' || node.type === 'footnoteDefinition' || node.type === 'thematicBreak') continue;
        if (node.type === 'code') parts.push(`\u0000code:${node.lang ?? ''}\u0000${node.value}\u0000`);
        else if (node.type === 'inlineCode') parts.push(`\u0000inline:${node.value}\u0000`);
        else if (node.type === 'text') {
            let value = node.value;
            // CommonMark can leave emphasis delimiters literal around CJK
            // punctuation. Remove only an exact span independently declared
            // as that style by this native body; literal asterisks stay literal.
            const start = node.position?.start.offset, end = node.position?.end.offset;
            // Escapes/entities make delimiters authored literal characters.
            // Require an unchanged raw text segment before treating a literal
            // delimiter pair as the native style's Markdown representation.
            if (start !== undefined && end !== undefined && source.slice(start, end) === value) {
                for (const decoration of decorations) value = value.split(decoration.marker + decoration.text + decoration.marker).join(decoration.text);
            }
            parts.push(value);
        } else if (node.type === 'inlineMath' || node.type === 'math') {
            if (hasMath) parts.push(node.value);
            else {
                const start = node.position?.start.offset, end = node.position?.end.offset;
                if (start === undefined || end === undefined) return null;
                parts.push(source.slice(start, end));
            }
        }
        else if (node.type === 'break') parts.push(' ');
        else if ('children' in node) {
            const children = markdownText(node.children, source, decorations, hasMath);
            if (children === null) return null;
            parts.push(children);
        } else return null;
        if (['paragraph', 'heading', 'listItem', 'tableCell', 'tableRow', 'blockquote'].includes(node.type)) parts.push(' ');
    }
    return parts.join('');
}
function nativeText(nodes: readonly GeminiStructuredNode[]): string | null {
    const parts: string[] = [];
    for (const node of nodes) {
        if (node.nodeType === 18) {
            if (node.text.includes('\u0000')) return null;
            let cursor = 0;
            const code = (node.annotations ?? []).filter(a => a.type === 7).sort((a, b) => a.start - b.start);
            for (const span of code) {
                if (span.start < cursor || span.end > node.text.length) return null;
                parts.push(node.text.slice(cursor, span.start), `\u0000inline:${node.text.slice(span.start, span.end)}\u0000`);
                cursor = span.end;
            }
            parts.push(node.text.slice(cursor), ' ');
        } else if (node.nodeType === 1) {
            if (node.code.includes('\u0000') || node.info?.includes('\u0000')) return null;
            parts.push(`\u0000code:${node.info ?? ''}\u0000${node.code.replace(/\n$/, '')}\u0000`);
        } else if (node.nodeType === 12) {
            if (node.FTa.includes('\u0000')) return null;
            parts.push(node.FTa);
        }
        else if (node.nodeType === 13) parts.push(' ');
        else if (node.nodeType === 'citation' || node.nodeType === 'sourceReference' || node.nodeType === 'citationGroup'
            || node.nodeType === 19 || node.nodeType === 0) continue;
        else if (node.nodeType === 'fragment' || node.nodeType === 'paragraph' || node.nodeType === 15) {
            const children = nativeText(node.children);
            if (children === null) return null;
            parts.push(children, ' ');
        } else if (node.nodeType === 14 || node.nodeType === 20) {
            for (const item of node.items) {
                const children = nativeText(item.children);
                if (children === null) return null;
                parts.push(children, ' ');
            }
        } else if (node.nodeType === 17) {
            for (const row of node.rows) for (const cell of row.cells) {
                const children = nativeText(cell.children);
                if (children === null) return null;
                parts.push(children, ' ');
            }
        } else return null;
    }
    return parts.join('');
}
function signature(value: string): string {
    // Code segments have sentinels so prose normalization never erases Python
    // indentation, code newlines or whitespace inside an inline code span.
    return value.split(/(\u0000(?:code:[^\u0000]*\u0000[^\u0000]*|inline:[^\u0000]*)\u0000)/)
        .map(part => part.startsWith('\u0000') ? part : prose(part)).filter(Boolean).join(' ');
}
export function matchesCandidateBody(document: GeminiStructuredDocument, markdown: string): boolean {
    // Sentinels below are internal signature delimiters, never source text.
    if (markdown.includes('\u0000')) return false;
    const decorations: Array<{ marker: string; text: string }> = [];
    let hasMath = false;
    const visit = (nodes: readonly GeminiStructuredNode[]): void => {
        for (const node of nodes) {
            if (node.nodeType === 12) hasMath = true;
            if (node.nodeType === 18) for (const annotation of node.annotations ?? []) {
                if (annotation.type === 4) hasMath = true;
                const marker = annotation.type === 0 ? '**' : annotation.type === 5 || annotation.type === 2 ? '*' : annotation.type === 12 ? '~~' : undefined;
                if (marker && annotation.start >= 0 && annotation.end <= node.text.length && annotation.start < annotation.end) {
                    decorations.push({ marker, text: node.text.slice(annotation.start, annotation.end) });
                }
            }
            if ('children' in node) visit(node.children);
            else if ('items' in node) node.items.forEach(item => visit(item.children));
            else if ('rows' in node) node.rows.forEach(row => row.cells.forEach(cell => visit(cell.children)));
        }
    };
    visit(document.children);
    const native = nativeText(document.children);
    const independent = markdownText(parseMarkdownAst(markdown).children, markdown, decorations, hasMath);
    return native !== null && independent !== null && Boolean(native.trim()) && signature(native) === signature(independent);
}
