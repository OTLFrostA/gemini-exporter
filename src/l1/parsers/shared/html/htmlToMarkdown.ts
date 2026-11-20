import { unescapeHtml } from "../../../../shared/utils/titleText.js";

function stripHtmlTags(str: string): string {
    let prev = '';
    let current = str;
    do {
        prev = current;
        current = current.replace(/<[^>]+>/g, '');
    } while (current !== prev);
    return current;
}

const HTML_CODE_BLOCK = /<pre><code(?:\s+class=["'](?:language-)?([a-z0-9_-]+)["'])?>([\s\S]*?)<\/code><\/pre>/gi;
const HTML_INLINE_CODE = /<code>([\s\S]*?)<\/code>/gi;

const HTML_MARKUP = /<!--(?:(?!<!--)[\s\S])*?-->|<\/?[a-z][\w:-]*(?=[\s/>])(?:[^'"<>]|"[^"]*"|'[^']*')*>/;
const HTML_INLINE_CODE_BODY = /(?:(?!<\/?code>)[\s\S])*/;
// Leave separate Markdown examples of opening and closing tags visible to the span scanner.
const HTML_INLINE_CODE_TOKEN = new RegExp(
    '<code>(?![ \t]*`+\\s' + HTML_INLINE_CODE_BODY.source + '`</code>`)' + HTML_INLINE_CODE_BODY.source + '</code>',
);
const MARKDOWN_RUN = /`+|\r?\n[ \t]*\r?\n/;
const DELIMITER_TOKENS = new RegExp([
    HTML_CODE_BLOCK.source, HTML_INLINE_CODE_TOKEN.source, HTML_MARKUP.source, MARKDOWN_RUN.source,
].join('|'), 'gi');

function escapedBacktick(source: string, index: number): number {
    let preceding = index;
    while (source[preceding - 1] === '\\') preceding--;
    return (index - preceding) % 2;
}

function stashMarkdownCodeSpans(source: string, stash: (code: string) => string): string {
    if (!source.includes('`')) return source;

    const tokens = [...source.matchAll(DELIMITER_TOKENS)];
    const tableStarts: number[] = [];
    const tableBoundaries = new Map<number, 'open' | 'close'>();
    for (const { 0: token, index } of tokens) {
        if (/^<table(?=[\s>])/i.test(token)) tableStarts.push(index);
        else if (/^<\/table\s*>$/i.test(token)) {
            const start = tableStarts.pop();
            if (start !== undefined) {
                tableBoundaries.set(start, 'open');
                tableBoundaries.set(index, 'close');
            }
        }
    }
    const scopes: Array<{ tag: string; nextByLength: Map<number, { index: number; paragraph: number }> }> = [
        { tag: '', nextByLength: new Map() },
    ];
    const outerScopeLengths: number[] = [];
    let paragraph = 0;
    const spans = new Map<number, { start: number; end: number }>();
    for (let i = tokens.length - 1; i >= 0; i--) {
        const { 0: run, index } = tokens[i];
        const scope = scopes[scopes.length - 1];
        if (run[0] !== '`') {
            if (/\r?\n[ \t]*\r?\n/.test(run)) paragraph++;
            const table = tableBoundaries.get(index);
            if (table === 'close') {
                outerScopeLengths.push(scopes.length);
                scopes.push({ tag: '', nextByLength: new Map() });
            } else if (table === 'open') {
                scopes.length = outerScopeLengths.pop() ?? 1;
            }
            const cellTag = outerScopeLengths.length ? /^<(\/?)(td|th)(?=[\s/>])/i.exec(run) : null;
            if (cellTag) {
                const tag = cellTag[2].toLowerCase();
                if (cellTag[1]) scopes.push({ tag, nextByLength: new Map() });
                else if (scope.tag === tag) scopes.pop();
            }
            continue;
        }
        const escaped = escapedBacktick(source, index);
        const length = run.length - escaped;
        const close = scope.nextByLength.get(length);
        if (close?.paragraph === paragraph) spans.set(index, { start: index + escaped, end: close.index + length });
        scope.nextByLength.set(run.length, { index, paragraph });
    }

    const parts: string[] = [];
    let start = 0;
    for (const { index } of tokens) {
        if (index < start) continue;
        const span = spans.get(index);
        if (!span) continue;
        parts.push(source.slice(start, span.start), stash(source.slice(span.start, span.end)));
        start = span.end;
    }
    return parts.join('') + source.slice(start);
}

export function convertHtmlToMarkdown(html?: string | null): string {
    if (!html) return '';
    if (!/<(?:pre|code|p|h[1-6]|ul|ol|li|blockquote|strong|b|em|i|table|a|img)[\s/>]/i.test(html)) return html;

    let res = html;
    const __codeSpans: string[] = [];
    const __stashCode = (code: string): string => {
        __codeSpans.push(code);
        return `\uFFFDCODE${__codeSpans.length - 1}\uFFFD`;
    };
    const __restoreCode = (str: string, transform = (code: string) => code): string =>
        str.replace(/\uFFFDCODE(\d+)\uFFFD/g, (_m: string, i: string) => transform(__codeSpans[Number(i)]));
    // Existing fenced Markdown is authored code, even when it contains HTML-like tags.
    // Recognize both CommonMark fence styles before interpreting real HTML tags.
    const lines = res.match(/[^\n]*(?:\n|$)/g) ?? [];
    let outside = '';
    let prose = '';
    let pending = '';
    let opened: { marker: string; length: number } | null = null;
    let inHtmlPre = false;
    for (const line of lines) {
        if (!line) continue;
        const content = line.replace(/\r?\n$/, '');
        if (opened) {
            pending += line;
            const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(content);
            if (closing && closing[1][0] === opened.marker && closing[1].length >= opened.length) {
                outside += __stashCode(pending);
                pending = '';
                opened = null;
            }
        } else {
            // Backticks inside a real HTML <pre> are content, not Markdown delimiters.
            if (/<pre(?:\s|>)/i.test(content)) inHtmlPre = true;
            const opening = inHtmlPre ? null : /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(content);
            if (opening && (opening[1][0] === '~' || !opening[2].includes('`'))) {
                outside += stashMarkdownCodeSpans(prose, __stashCode);
                prose = '';
                opened = { marker: opening[1][0], length: opening[1].length };
                pending = line;
            } else prose += line;
            if (/<\/pre\s*>/i.test(content)) inHtmlPre = false;
        }
    }
    res = outside + stashMarkdownCodeSpans(prose, __stashCode) + (pending ? __stashCode(pending) : '');

    const backticks = (content: string, min: number): string => {
        const longest = (content.match(/`+/g) ?? []).reduce((count, run) => Math.max(count, run.length), 0);
        return '`'.repeat(Math.max(min, longest + 1));
    };
    res = res.replace(HTML_CODE_BLOCK, (_match: string, lang: string | undefined, code: string) => {
        const cleanCode = unescapeHtml(code).trim();
        const fence = backticks(cleanCode, 3);
        return __stashCode(`\n${fence}${lang || ''}\n${cleanCode}\n${fence}\n`);
    });
    res = res.replace(HTML_INLINE_CODE, (_match: string, code: string) => {
        const content = unescapeHtml(code);
        const fence = backticks(content, 1);
        const pad = /^`|`$|^ .* $/.test(content) ? ' ' : '';
        return __stashCode(`${fence}${pad}${content}${pad}${fence}`);
    });
    res = res.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m: string, lvl: string, txt: string) => `\n${'#'.repeat(parseInt(lvl, 10))} ${txt.trim()}\n`);
    res = res.replace(/<(strong|b)(?=[\s/>])[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
    res = res.replace(/<(em|i)(?=[\s/>])[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
    // Bind visible HTML resources before the remaining tags are stripped. Code
    // has already been stashed, so literal <a>/<img> inside it stays literal.
    const attribute = (attributes: string, name: string): string | undefined => {
        for (const match of attributes.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
            if (match[1].toLowerCase() === name) return unescapeHtml(match[2] ?? match[3] ?? match[4] ?? '');
        }
        return undefined;
    };
    const destination = (value: string | undefined): string | undefined => {
        if (!value || /[\u0000-\u0020]/.test(value)) return undefined;
        if (/^[a-z][\w+.-]*:/i.test(value) && !/^(?:https?|mailto|cid):/i.test(value)) return undefined;
        return value.replace(/[<>()]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
    };
    const label = (value: string): string => value.replace(/[\\[\]]/g, '\\$&');
    res = res.replace(/<img\b([^>]*)>/gi, (_match: string, attributes: string) => {
        const alt = attribute(attributes, 'alt') ?? '';
        const target = destination(attribute(attributes, 'src'));
        return target ? `![${label(alt)}](${target})` : label(alt);
    });
    res = res.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match: string, attributes: string, content: string) => {
        const target = destination(attribute(attributes, 'href'));
        return target ? `[${content}](${target})` : content;
    });
    res = res.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_match: string, tableContent: string) => {
        const parsedRows: Array<Array<{ value: string; colSpan: number; rowSpan: number }>> = [];
        const span = (attributes: string, name: 'colspan' | 'rowspan'): number => {
            const match = (name === 'colspan'
                ? /\bcolspan\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))/i
                : /\browspan\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))/i).exec(attributes);
            const value = Number(match?.[1] ?? match?.[2] ?? match?.[3] ?? 1);
            return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 256) : 1;
        };
        for (const tr of tableContent.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
            const cells: Array<{ value: string; colSpan: number; rowSpan: number }> = [];
            for (const match of tr[1].matchAll(/<(?:th|td)\b([^>]*)>([\s\S]*?)<\/(?:th|td)>/gi)) {
                let value = match[2];
                value = value.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1<br>');
                value = value.replace(/<br\s*\/?>/gi, '__TABLE_BR__');
                value = stripHtmlTags(value);
                value = unescapeHtml(value).replace(/\r?\n/g, ' ').trim();
                value = value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
                value = __restoreCode(value, code => __stashCode(
                    code.replace(/(\\*)\|/g, (pipe: string, slashes: string) => slashes.length % 2 ? pipe : '\\' + pipe),
                ));
                cells.push({ value, colSpan: span(match[1], 'colspan'), rowSpan: span(match[1], 'rowspan') });
            }
            if (cells.length) parsedRows.push(cells);
        }

        // HTML spans occupy columns in later rows; Markdown represents each as
        // one text cell followed by blanks, without discarding neighboring text.
        const activeSpans = new Map<number, number>();
        const flatRows: string[][] = [];
        for (const cells of parsedRows) {
            const columns: string[] = [];
            const occupied = new Set(activeSpans.keys());
            for (const column of occupied) columns[column] = '';
            let next = 0;
            for (const cell of cells) {
                const fits = (column: number): boolean => {
                    for (let offset = 0; offset < cell.colSpan; offset++)
                        if (occupied.has(column + offset)) return false;
                    return true;
                };
                while (!fits(next)) next++;
                columns[next] = cell.value;
                for (let offset = 0; offset < cell.colSpan; offset++) {
                    const column = next + offset;
                    if (offset) columns[column] = '';
                    occupied.add(column);
                    if (cell.rowSpan > 1) activeSpans.set(column, cell.rowSpan);
                }
                next += cell.colSpan;
            }
            for (const [column, remaining] of activeSpans) {
                if (remaining <= 1) activeSpans.delete(column);
                else activeSpans.set(column, remaining - 1);
            }
            flatRows.push(columns);
        }
        if (!flatRows.length) return '';
        const colCount = flatRows.reduce((width, cells) => Math.max(width, cells.length), 0);
        const rows: string[] = [];
        flatRows.forEach((cells, index) => {
            const padded = Array.from({ length: colCount }, (_, column) => cells[column] ?? '');
            rows.push('| ' + padded.join(' | ') + ' |');
            if (index === 0) rows.push('| ' + new Array(colCount).fill('---').join(' | ') + ' |');
        });
        return '\n\n' + rows.join('\n') + '\n\n';
    });
    res = res.replace(/<br\s*\/?>/gi, '\n');
    res = res.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
    res = stripHtmlTags(res);
    res = __restoreCode(res);
    res = res.replace(/__TABLE_BR__/g, '<br>');
    return res;
}
