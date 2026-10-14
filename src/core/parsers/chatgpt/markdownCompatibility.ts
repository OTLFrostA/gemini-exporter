/**
 * ChatGPT Markdown dialect normalization (provider preprocessing).
 * The shared mdast parser stays generic; dialect quirks end here, mirroring
 * parsers/gemini/shared/markdownCompatibility.ts.
 *
 * ChatGPT emits:
 * - display math as `\\[ ... \\]` and inline math as `\\( ... \\)`
 *   (normalized to `$$` / `$`, which the shared math extension parses);
 * - telemetry citation markers in Unicode private-use code points
 *   (`cite turn0search0`); stripped so exports stay telemetry-free;
 * - raw HTML (notably `<br>` inside tables); tags are dropped, `<br>` folds
 *   to a space so table cells do not glue words together.
 */

// Fenced code blocks and inline code keep their backslashes and dollars.
const CODE_SPAN = /(```[\s\S]*?(?:```|$)|`[^`\n]+`)/g;

// Own-line `\[ ... \]` -> `$$` block; anywhere `\[...\]` -> `$$...$$`;
// `\(...\)` -> `$...$`. Code spans are shielded by the caller.
const BRACKET_DISPLAY_OWN_LINES = /^[ \t]*\\\[(?<block>[\s\S]+?)\\\][ \t]*$/gm;
const BRACKET_DISPLAY_INLINE = /\\\[(?<display>[\s\S]+?)\\\]/g;
const BRACKET_INLINE = /\\\((?<inline>[\s\S]+?)\\\)/g;

// Telemetry markers are ASCII words (`cite`, `turn0search0`) framed by
// private-use delimiters: `<PUA>cite<PUA>turn0search0<PUA>`. The words alone
// are meaningless without the frame, so the whole marker goes; normal prose
// never interleaves PUA code points this way. Lone PUA strays are dropped too.
const TELEMETRY_MARKER = /[\uE000-\uF8FF]*cite[\uE000-\uF8FF]*turn[0-9a-z]*[\uE000-\uF8FF]*/g;
const PUA_STRAY = /[\uE000-\uF8FF]+/g;

const BR_TAG = /<br\s*\/?>/gi;
const ANY_TAG = /<[^>]+>/g;

function normalizeMathOutsideCode(text: string): string {
    return text
        .replace(BRACKET_DISPLAY_OWN_LINES, (_m, block: string) => `$$\n${block}\n$$`)
        .replace(BRACKET_DISPLAY_INLINE, (_m, display: string) => `$$${display}$$`)
        .replace(BRACKET_INLINE, (_m, inline: string) => `$${inline}$`);
}

/** Normalize one ChatGPT message body for the shared Markdown parser. */
export function preprocessChatGPTMarkdown(source: string): string {
    if (!source) return source;
    // Shield code spans from every rewrite below.
    const parts = source.split(CODE_SPAN);
    for (let i = 0; i < parts.length; i += 2) {
        let part = parts[i] ?? '';
        part = normalizeMathOutsideCode(part);
        part = part.replace(TELEMETRY_MARKER, '').replace(PUA_STRAY, '');
        part = part.replace(BR_TAG, ' ').replace(ANY_TAG, '');
        parts[i] = part;
    }
    return parts.join('');
}
