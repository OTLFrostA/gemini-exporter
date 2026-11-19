// Fenced code blocks (backticks or tildes) and inline code spans keep their backslashes and dollars.
const CODE_SPAN = /^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)|`+[^`\n]+`+/gm;

const BRACKET_DISPLAY_OWN_LINES = /^[ \t]*\\\[(?<block>[\s\S]+?)\\\][ \t]*$/gm;
const BRACKET_DISPLAY_INLINE = /\\\[(?<display>[\s\S]+?)\\\]/g;
// Negative lookahead prevents an unclosed `\(` from swallowing a later formula on the same line.
const BRACKET_INLINE = /\\\((?<inline>(?:(?!\\\()[^\r\n])+?)\\\)/g;

/** Transform only prose segments outside fenced and inline Markdown code spans. */
export function transformMarkdownOutsideCode(source: string, transform: (prose: string) => string): string {
    if (!source) return source;
    const spans = new RegExp(CODE_SPAN);
    const parts: string[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = spans.exec(source)) !== null) {
        parts.push(transform(source.slice(cursor, match.index)));
        const fence = match[1];
        if (fence) {
            const closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*\\r?$`, 'gm');
            closing.lastIndex = spans.lastIndex;
            const end = closing.exec(source);
            spans.lastIndex = end ? closing.lastIndex : source.length;
        }
        parts.push(source.slice(match.index, spans.lastIndex));
        cursor = spans.lastIndex;
    }
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
