import type { Nodes } from 'mdast';
import { parseMarkdownAst } from './parseMarkdown.js';

const BRACKET_DISPLAY_OWN_LINES = /^[ \t]*\\\[(?<block>[\s\S]+?)\\\][ \t]*$/gm;
const BRACKET_DISPLAY_INLINE = /\\\[(?<display>[\s\S]+?)\\\]/g;
// Negative lookahead prevents an unclosed `\(` from swallowing a later formula on the same line.
const BRACKET_INLINE = /\\\((?<inline>(?:(?!\\\()[^\r\n])+?)\\\)/g;

/** Transform only prose segments outside fenced and inline Markdown code spans. */
export function transformMarkdownOutsideCode(source: string, transform: (prose: string) => string): string {
    if (!source) return source;
    const parts: string[] = [];
    let cursor = 0;
    function visit(node: Nodes): void {
        if (node.type === 'code' || node.type === 'inlineCode') {
            const start = node.position?.start.offset;
            const end = node.position?.end.offset;
            if (start !== undefined && end !== undefined) {
                parts.push(transform(source.slice(cursor, start)), source.slice(start, end));
                cursor = end;
            }
        } else if ('children' in node) {
            for (const child of node.children) visit(child);
        }
    }
    visit(parseMarkdownAst(source));
    parts.push(transform(source.slice(cursor)));
    return parts.join('');
}

/** Normalize LaTeX `\[...\]` and `\(...\)` delimiters to `$$` / `$` inside non-code prose. */
export function normalizeTexBracketsInProse(prose: string, inlineDisplayAsBlock = false): string {
    return prose
        .replace(BRACKET_DISPLAY_OWN_LINES, (_m, block: string) => `$$\n${block}\n$$`)
        .replace(BRACKET_DISPLAY_INLINE, (_m, display: string) =>
            inlineDisplayAsBlock ? `\n$$\n${display}\n$$\n` : `$$${display}$$`)
        .replace(BRACKET_INLINE, (_m, inline: string) => `$${inline}$`);
}
