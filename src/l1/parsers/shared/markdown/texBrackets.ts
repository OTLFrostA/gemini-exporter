// Fenced code blocks (backticks or tildes) and inline code spans keep their backslashes and dollars.
const CODE_SPAN = /(`{3,}[\s\S]*?(?:`{3,}|$)|~{3,}[\s\S]*?(?:~{3,}|$)|`+[^`\n]+`+)/g;

const BRACKET_DISPLAY_OWN_LINES = /^[ \t]*\\\[(?<block>[\s\S]+?)\\\][ \t]*$/gm;
const BRACKET_DISPLAY_INLINE = /\\\[(?<display>[\s\S]+?)\\\]/g;
// Negative lookahead prevents an unclosed `\(` from swallowing a later formula on the same line.
const BRACKET_INLINE = /\\\((?<inline>(?:(?!\\\()[^\r\n])+?)\\\)/g;

/** Transform only prose segments outside fenced and inline Markdown code spans. */
export function transformMarkdownOutsideCode(source: string, transform: (prose: string) => string): string {
    if (!source) return source;
    const parts = source.split(CODE_SPAN);
    for (let i = 0; i < parts.length; i += 2) {
        parts[i] = transform(parts[i] ?? '');
    }
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
